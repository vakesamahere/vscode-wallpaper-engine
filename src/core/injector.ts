import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { toVsCodeResourceUrl } from '../utils'; 
import { saveFilePrivileged } from './admin-saver';
import { WALLPAPER_SERVER_PORT } from '../config/constants';
import { WallpaperType } from './types';

// --- 常量定义 ---
const JS_INJECTION_REGEX = /\s*\/\* \[VSCode-Wallpaper-Injection-Start\] \*\/[\s\S]*?\/\* \[VSCode-Wallpaper-Injection-End\] \*\//g;
const HTML_INJECTION_REGEX = /\s*<!-- VSCode-Wallpaper-Injection-Start -->[\s\S\n]*?<!-- VSCode-Wallpaper-Injection-End -->/g;

// HTML 新 CSP 标记
const CSP_MARKER_START = '<!-- VSCode-Wallpaper-Injection-Start -->';
const CSP_MARKER_END = '<!-- VSCode-Wallpaper-Injection-End -->';

// 属性重命名策略
const ATTR_ORIGINAL = 'http-equiv="Content-Security-Policy"';
const ATTR_RENAMED = 'http-equiv="Content-Security-Policy--replaced-by-wallpaper-engine-plugin"';

// CSP abs content
const CSP_ABS_CONTENT = `
<meta charset="utf-8" />
		<meta
			http-equiv="Content-Security-Policy"
			content="
			default-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
			;
			img-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				data:
				blob:
				vscode-remote-resource:
				vscode-managed-remote-resource:
				https:
			;
			media-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
			;
			frame-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				vscode-webview:
			;
			script-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				'unsafe-eval'
				blob:
			;
			style-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				'unsafe-inline'
			;
			connect-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				https:
				ws:
			;
			font-src
				* 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https: ws: wss:
				'self'
				vscode-remote-resource:
				vscode-managed-remote-resource:
				https://*.vscode-unpkg.net
			;
		"/>
`;

function getWorkbenchPath(file: 'html' | 'js'): string | null {
    const root = vscode.env.appRoot;
    const basePaths = [
        path.join(root, 'out', 'vs', 'code', 'electron-browser', 'workbench'),
        path.join(root, 'out', 'vs', 'code', 'electron-sandbox', 'workbench'),
        path.join(root, 'out', 'vs', 'workbench')
    ];
    const filename = file === 'html' ? 'workbench.html' : 'workbench.desktop.main.js';
    for (const basePath of basePaths) {
        const fullPath = path.join(basePath, filename);
        if (fs.existsSync(fullPath)) { return fullPath; }
    }
    return null;
}

export function isPatched(): boolean {
    const jsPath = getWorkbenchPath('js');
    if (!jsPath) { return false; }
    try {
        const js = fs.readFileSync(jsPath, 'utf-8');
        return js.includes('/* [VSCode-Wallpaper-Injection-Start] */');
    } catch {
        return false;
    }
}

/**
 * [还原/卸载功能]
 * 1. JS: 清除注入代码
 * 2. HTML: 删除新插入的 CSP 块，将重命名的属性改回原样
 */
export async function restoreWorkbench() {
    const htmlPath = getWorkbenchPath('html');
    const jsPath = getWorkbenchPath('js');

    try {
        // 1. 还原 HTML
        if (htmlPath) {
            let html = fs.readFileSync(htmlPath, 'utf-8');
            let changed = false;

            // A. 删除插入的新 CSP 块
            // 匹配 
            const blockRegex = new RegExp(`\\s*${escapeRegExp(CSP_MARKER_START)}[\\s\\S]*?${escapeRegExp(CSP_MARKER_END)}`, 'g');
            if (html.match(blockRegex)) {
                console.log("正在移除注入的 CSP...");
                html = html.replace(blockRegex, '');
                changed = true;
            }

            // B. 恢复原标签的属性名
            if (html.includes(ATTR_RENAMED)) {
                console.log("正在恢复原版 CSP 属性名...");
                // 全局替换回原名
                html = html.split(ATTR_RENAMED).join(ATTR_ORIGINAL);
                changed = true;
            }

            if (changed) {
                await saveFilePrivileged(htmlPath, html);
            }
        }

        // 2. 还原 JS
        if (jsPath) {
            let js = fs.readFileSync(jsPath, 'utf-8');
            if (js.match(JS_INJECTION_REGEX)) {
                console.log("正在清理 JS 注入...");
                js = js.replace(JS_INJECTION_REGEX, '');
                await saveFilePrivileged(jsPath, js);
            }
        }
        
        const action = await vscode.window.showInformationMessage('已还原。', '立即重启');
        if (action === '立即重启') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }

    } catch (e: any) {
        vscode.window.showErrorMessage('还原失败: ' + e.message);
    }
}

/**
 * [安装/Patch 功能]
 * 1. 找到原 CSP 标签，重命名其属性使其失效
 * 2. 在其下方插入修改后的新 CSP 标签
 */
async function patchWorkbenchHtml() {
    const targetHtml = getWorkbenchPath('html');
    if (!targetHtml) { return; }

    let html = fs.readFileSync(targetHtml, 'utf-8');
    if (html.includes(ATTR_RENAMED)) { return; }

    const metaTagRegex = /<meta[\s\S\n]*?http-equiv="Content-Security-Policy"[\s\S\n]*?>/i;
    const match = html.match(metaTagRegex);
    if (!match) { return; }

    const originalTag = match[0];
    const disabledTag = originalTag.replace(ATTR_ORIGINAL, ATTR_RENAMED);

    let newTagContent = originalTag;
    newTagContent = newTagContent.replace(/require-trusted-types-for[\s\S]*?'script'[\s\S]*?;/g, '');

    const contentRegex = /content="([\s\S]*?)"/i;
    const contentMatch = newTagContent.match(contentRegex);
    
    if (contentMatch) {
        const oldContent = contentMatch[1];
        const looseRules = `default-src * 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https:; connect-src * vscode-file: file: data: blob: http: https:; frame-src * vscode-file: file: data: blob: http: https:; script-src * 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob: http: https:; `;
        const newContent = `${looseRules}${oldContent}`;
        newTagContent = newTagContent.replace(contentRegex, `content="${newContent}"`);
    }

    const injectionBlock = `
${disabledTag}
${CSP_MARKER_START}
${CSP_ABS_CONTENT}
${CSP_MARKER_END}
`;
    console.log("应用 CSP 补丁...");
    html = html.replace(originalTag, injectionBlock);
    await saveFilePrivileged(targetHtml, html);
}
async function injectJs(mediaPath: string, type: WallpaperType, opacity: number, port: number, customJs: string, resizeDelay: number, startupCheckInterval: number, showDebugSidebar: boolean) {
    const jsPath = getWorkbenchPath('js');
    if (!jsPath) { return; }
    
    let elementCreationCode = '';

    if (type === WallpaperType.Video) {
        const finalUrl = toVsCodeResourceUrl(mediaPath);
        elementCreationCode = `
            el = document.createElement('video');
            el.src = "${finalUrl}";
            el.autoplay = true;
            el.loop = true;
            el.muted = true;
            el.play();
            el.style.opacity = '${opacity}';
        `;
    } else if (type === WallpaperType.Image) {
        const finalUrl = toVsCodeResourceUrl(mediaPath);
        elementCreationCode = `
            el = document.createElement('img');
            el.src = "${finalUrl}";
            el.style.opacity = '${opacity}';
        `;
    } else if (type === WallpaperType.Web) {
        const pingUrl = `http://127.0.0.1:${port}/ping`;
        const entryUrl = `http://127.0.0.1:${port}/api/get-entry`;
        
        elementCreationCode = `
            const entryUrl = "${entryUrl}";
            const pingUrl = "${pingUrl}";

            // 1. 创建 Loading 元素
            const loader = document.createElement('div');
            loader.innerHTML = '<div style="width: 30px; height: 30px; border: 3px solid rgba(255,255,255,0.3); border-top: 3px solid #fff; border-radius: 50%; animation: vscode-wallpaper-spin 1s linear infinite;"></div>';
            loader.style.position = 'absolute';
            loader.style.top = '50%';
            loader.style.left = '50%';
            loader.style.transform = 'translate(-50%, -50%)';
            loader.style.zIndex = '100000';
            
            // 注入动画样式
            if (!document.getElementById('vscode-wallpaper-style')) {
                const style = document.createElement('style');
                style.id = 'vscode-wallpaper-style';
                style.textContent = '@keyframes vscode-wallpaper-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
                document.head.appendChild(style);
            }
            
            container.appendChild(loader);

            // 2. 创建 iframe
            el = document.createElement('iframe');
            el.className = 'vscode-wallpaper-iframe';
            el.frameBorder = '0';
            el.allow = "autoplay; fullscreen; microphone; display-capture";
            el.style.opacity = '0'; // 初始隐藏
            el.style.transition = 'opacity 0.5s ease-in-out';
            
            const srcdocContent = \`
            <!DOCTYPE html>
            <html>
            <head>
                <base href='http://127.0.0.1:${port}/' />
                <style>body, html { margin: 0; padding: 0; overflow: hidden; background: black; }</style>
            </head>
            <body>
                <script>
                    const entryUrl = '${entryUrl}';
                    async function loadWallpaper() {
                        let attempts = 0;
                        while(attempts < 200) {
                            try {
                                const resp = await fetch(entryUrl);
                                if(!resp.ok) throw new Error('Server not ready');
                                let html = await resp.text();
                                
                                // [Fix] Inject <base> tag to ensure relative paths work
                                if (!html.includes('<base')) {
                                    const baseTag = "<base href='http://127.0.0.1:${port}/' />";
                                    if (html.includes('<head>')) {
                                        html = html.replace('<head>', '<head>' + baseTag);
                                    } else if (html.includes('<html>')) {
                                        html = html.replace('<html>', '<html><head>' + baseTag + '</head>');
                                    } else {
                                        html = '<head>' + baseTag + '</head>' + html;
                                    }
                                }

                                // [Fix] Static HTML file:// replacement
                                html = html.replace(/(src|href)\\\\s*=\\\\s*(["'])file:\\\\/\\\\/\\\\//gi, '$1=$2/');
                                html = html.replace(/url\\\\(\\\\s*(["']?)file:\\\\/\\\\/\\\\//gi, 'url($1/');
                                
                                const interceptor =  
                                    "<script>" +
                                    "(function(){" +
                                    "    function r(u){" +
                                    "        if(!u||typeof u!=='string')return u;" +
                                    "        if(u.startsWith('file:///'))return u.replace('file:///','/');" +
                                    "        return u;" +
                                    "    }" +
                                    "    const f=window.fetch;" +
                                    "    window.fetch=function(i,n){" +
                                    "        if(typeof i==='string')i=r(i);" +
                                    "        return f(i,n);" +
                                    "    };" +
                                    "    const o=XMLHttpRequest.prototype.open;" +
                                    "    XMLHttpRequest.prototype.open=function(m,u,...a){" +
                                    "        u=r(u);" +
                                    "        return o.call(this,m,u,...a);" +
                                    "    };" +
                                    "    function s(p){" +
                                    "        const d=Object.getOwnPropertyDescriptor(p,'src');" +
                                    "        if(d&&d.set){" +
                                    "            const os=d.set;" +
                                    "            Object.defineProperty(p,'src',{" +
                                    "                set:function(v){" +
                                    "                    if(this.tagName==='IMG'||this.tagName==='VIDEO'||this.tagName==='AUDIO'){" +
                                    "                        this.crossOrigin='anonymous';" +
                                    "                    }" +
                                    "                    os.call(this,r(v));" +
                                    "                }," +
                                    "                get:d.get," +
                                    "                enumerable:d.enumerable," +
                                    "                configurable:d.configurable" +
                                    "            });" +
                                    "        }" +
                                    "    }" +
                                    "    if(window.HTMLImageElement)s(window.HTMLImageElement.prototype);" +
                                    "    if(window.HTMLAudioElement)s(window.HTMLAudioElement.prototype);" +
                                    "    if(window.HTMLVideoElement)s(window.HTMLVideoElement.prototype);" +
                                    "    if(window.HTMLScriptElement)s(window.HTMLScriptElement.prototype);" +
                                    "})();" +
                                    "<\\\\/script>";

                                if (html.includes('<head>')) {
                                    html = html.replace('<head>', '<head>' + interceptor);
                                } else {
                                    html = interceptor + html;
                                }
                                document.open();
                                document.write(html);
                                document.close();
                                return;
                            } catch(err) {
                                console.warn('Wallpaper Load Retry:', err);
                                attempts++;
                                await new Promise(r => setTimeout(r, 500));
                            }
                        }
                        document.body.innerHTML = '<h1 style=color:red>Connection Failed</h1>';
                    }
                    loadWallpaper();
                </script>
            </body>
            </html>
            \`;
            
            // Expose control functions to global scope
            window.reloadWallpaper = () => {
                el.srcdoc = srcdocContent;
            };
            
            window.showWallpaper = () => {
                el.style.opacity = '${opacity}';
                if (loader.parentNode) loader.remove();
            };
            
            window.hideWallpaper = () => {
                el.style.opacity = '0';
                container.appendChild(loader);
            };

            el.onload = () => {
                window.showWallpaper();
            };
        `;
    }

    const SIDEBAR_CSS = `
    #vscode-wallpaper-sidebar input[type="range"], #vscode-wallpaper-sidebar input[type="color"], #vscode-wallpaper-sidebar select { width: 100%; background: #3c3c3c; border: 1px solid #555; color: white; margin-top: 5px; }
    #vscode-wallpaper-sidebar .control-item { margin-bottom: 15px; }
    #vscode-wallpaper-sidebar label { display: block; font-size: 11px; color: #888; margin-bottom: 4px; }
    #vscode-wallpaper-sidebar span.val { float: right; font-size: 11px; color: #007acc; }
    ${(()=>{if (showDebugSidebar) {return "";} else {
        return "#vscode-wallpaper-sidebar { display: none !important; } #vscode-wallpaper-sidebar + #sidebar-open-btn { display: none !important; }";
    }})()}
    `;

    const jsInjection = `
/* [VSCode-Wallpaper-Injection-Start] */
(function() {
    try {
        const oldContainer = document.getElementById('vscode-wallpaper-container');
        if (oldContainer) oldContainer.remove();

        const container = document.createElement('div');
        container.id = 'vscode-wallpaper-container';
        container.style.position = 'fixed'; 
        container.style.top = '0'; 
        container.style.left = '0'; 
        container.style.width = '100%'; 
        container.style.height = '100%';
        container.style.zIndex = '-1';
        container.style.pointerEvents = 'none';
        container.style.opacity = '1';
        container.style.display = 'flex';

        const SERVER_ROOT = 'http://127.0.0.1:${port}';
        const PING_URL = SERVER_ROOT + '/ping';
        const CONFIG_URL = SERVER_ROOT + '/config';

        // Inject Transparency CSS
        const transparencyStyle = document.createElement('style');
        transparencyStyle.id = 'vscode-wallpaper-transparency';
        document.head.appendChild(transparencyStyle);

        async function updateCss() {
            try {
                console.log("[WP style inj] Fetching config from " + CONFIG_URL);
                const res = await fetch(CONFIG_URL);
                if (res.ok) {
                    const config = await res.json();
                    console.log("[WP style inj] Got config:", config);
                    const css = config.customCss;
                    
                    if (transparencyStyle.textContent !== css) {
                        console.log("[WP style inj] Updating style tag content...");
                        transparencyStyle.textContent = css;
                        console.log("[WP style inj] Update complete.");
                    } else {
                        console.log("[WP style inj] CSS is identical, skipping update.");
                    }
                } else {
                    console.error("[WP style inj] Fetch failed status:", res.status);
                }
            } catch (e) { console.error("[WP style inj] CSS Update Failed", e); }
        }

        async function mainLoop() {
            // 1. Wait for server
            const start = Date.now();
            while (true) {
                try {
                    const resp = await fetch(PING_URL, { method: 'GET', mode: 'cors' });
                    if (resp.ok || resp.status === 205) {
                        console.log("[WP] Server is ready!");
                        break;
                    }
                } catch (e) { }
                await new Promise(resolve => setTimeout(resolve, 200));
                if (Date.now() - start > 30000) { console.error("[WP] Server timeout"); return; }
            }

            // 2. Initialize
            await updateCss();
            if (typeof initSidebar === 'function') initSidebar();
            if (window.reloadWallpaper) window.reloadWallpaper();
            
            // 3. Monitor Loop
            while(true) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                try {
                    const resp = await fetch(PING_URL, { method: 'GET', mode: 'cors' });
                    if (resp.status === 205) {
                        console.log("[WP style inj] Reload signal received (205).");
                        await updateCss();
                        if (window.reloadWallpaper) window.reloadWallpaper();
                    }
                } catch(e) {
                    console.warn("[WP] Server disconnected...");
                    if (window.hideWallpaper) window.hideWallpaper();
                    // Re-enter wait loop
                    mainLoop(); 
                    return;
                }
            }
        }
        
        mainLoop();

        // Sidebar
        if (true) {
            // container.style.pointerEvents = 'auto';
            
            // Use insertAdjacentHTML to handle multiple root elements correctly
            container.insertAdjacentHTML('beforeend', \`${SIDEBAR_HTML}\`);
            
            const style = document.createElement('style');
            style.textContent = \`${SIDEBAR_CSS}\`;
            document.head.appendChild(style);
            
            var initSidebar = function() {
                console.log("[Sidebar] JS Injection Starting...");
                try {
                    // Ensure we search in the document, container should be appended by now
                    const panel = document.getElementById('propsPanel');
                    if (panel) panel.innerText = "Initializing...";
                    else console.error("[Sidebar] propsPanel not found!");
                    
                    ${SIDEBAR_JS_LOGIC}
                    
                    const SERVER_ROOT = 'http://127.0.0.1:${port}';
                    console.log("[Sidebar] Fetching project.json from " + SERVER_ROOT);
                    
                    if (panel) panel.innerText = "Fetching config from " + SERVER_ROOT + "...";

                    fetch(SERVER_ROOT + '/project.json')
                        .then(res => {
                            console.log("[Sidebar] Response status:", res.status);
                            if (!res.ok) throw new Error("Status " + res.status);
                            return res.json();
                        })
                        .then(json => {
                            console.log("[Sidebar] Got JSON:", json);
                            renderUI(json);
                        })
                        .catch(e => {
                            console.error("[Sidebar] Error:", e);
                            if (panel) panel.innerHTML = '<span style="color:orange">Failed to load project.json: ' + e.message + '</span>';
                        });

                    // Toggle Logic
                    const sidebar = document.getElementById('vscode-wallpaper-sidebar');
                    const closeBtn = document.getElementById('sidebar-close-btn');
                    const openBtn = document.getElementById('sidebar-open-btn');

                    function toggleSidebar(show) {
                        if (show) {
                            sidebar.style.width = '300px';
                            openBtn.style.display = 'none';
                        } else {
                            sidebar.style.width = '0px';
                            openBtn.style.display = 'block';
                        }
                    }

                    if (closeBtn) closeBtn.onclick = () => {toggleSidebar(false); console.log("Close clicked");}
                    if (openBtn) openBtn.onclick = () => {toggleSidebar(true); console.log("Open clicked"); }

                    // [New] Open Folder Logic
                    const openFolderBtn = document.getElementById('openFolderBtn');
                    if (openFolderBtn) {
                        openFolderBtn.onclick = () => {
                            fetch(SERVER_ROOT + '/open-folder')
                                .then(r => {
                                    if (!r.ok) console.error('Failed to open folder');
                                })
                                .catch(e => console.error('Error opening folder:', e));
                        };
                    }

                    function updateProp(key, val) {
                        const payload = {};
                        payload[key] = { value: val };
                        if (el && el.contentWindow) {
                            el.contentWindow.postMessage({ type: 'UPDATE_PROPERTIES', data: payload }, '*');
                            el.contentWindow.postMessage({ type: 'PROPERTIES', data: payload }, '*');
                        }
                    }
                    window.updateProp = updateProp;

                } catch (err) {
                    console.error("[Sidebar] Critical Error:", err);
                    const panel = document.getElementById('propsPanel');
                    if (panel) panel.innerHTML = '<span style="color:red">JS Error: ' + err.message + '</span>';
                }
            };
        }

        const wrapper = document.createElement('div');
        wrapper.style.flex = '1';
        wrapper.style.position = 'relative';
        wrapper.style.height = '100%';
        wrapper.style.pointerEvents = 'none';

        let el;
        ${elementCreationCode}

        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';
        
        if (el.tagName === 'IFRAME') {
             el.style.border = 'none';
             el.style.display = 'block';
             el.style.pointerEvents = 'none'; 
        }

        wrapper.appendChild(el);
        container.appendChild(wrapper);
        document.body.appendChild(container);

        // Resize handler: Reload iframe on window resize
        if (el.tagName === 'IFRAME') {
             let resizeTimeout;
             window.addEventListener('resize', () => {
                 clearTimeout(resizeTimeout);
                 resizeTimeout = setTimeout(() => {
                     el.srcdoc = srcdocContent;
                 }, ${resizeDelay});
             });
        }

        try {
            ${customJs}
        } catch (e) { console.error("Custom JS Error:", e); }

    } catch (e) { console.error("Wallpaper Engine Error:", e); }
})();
/* [VSCode-Wallpaper-Injection-End] */`;

    try {
        let raw = fs.readFileSync(jsPath, 'utf-8');
        raw = raw.replace(JS_INJECTION_REGEX, '');
        await saveFilePrivileged(jsPath, raw + jsInjection);
    } catch (e) {
        throw new Error(`JS 注入失败: ${e}`);
    }
}

export async function performInjection(mediaPath: string, type: WallpaperType, opacity: number, port: number, customJs: string, resizeDelay: number, startupCheckInterval: number, autoRestart = true, showDebugSidebar = false) {
    try {
        await patchWorkbenchHtml();
        await injectJs(mediaPath, type, opacity, port, customJs, resizeDelay, startupCheckInterval, showDebugSidebar);
        
        if (autoRestart) {
            // 直接重启，无需用户确认
            vscode.window.setStatusBarMessage('Wallpaper installed. Restarting...', 5000);
            await vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(error.message || String(error));
    }
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}

const SIDEBAR_HTML = `
<div id="vscode-wallpaper-sidebar" style="width: 300px; min-width: 0; flex-shrink: 0; white-space: nowrap; background: #252526; border-right: 1px solid #333; display: flex; flex-direction: column; height: 100%; overflow: hidden; pointer-events: auto; z-index: 100001; transition: width 0.3s ease;">
    <div style="padding: 15px; background: #333; font-weight: bold; border-bottom: 1px solid #444; color: #ccc; display: flex; justify-content: space-between; align-items: center;">
        <span>WE Debugger</span>
        <button id="sidebar-close-btn" style="background:none; border:none; color:#ccc; cursor:pointer; font-weight:bold; padding: 0 5px; pointer-events: auto;">&lt;</button>
    </div>
    <div style="padding: 10px; border-bottom: 1px solid #444; background: #2d2d2d;">
        <label style="display: block; font-size: 11px; color: #888; margin-bottom: 5px;">Audio Source</label>
        <select id="audioSource" style="width:100%; background:#3c3c3c; color:white; border:1px solid #555; padding:2px; pointer-events: auto;">
            <option value="simulate">Simulate (Sine Wave)</option>
            <option value="mic">Microphone (Real Audio)</option>
            <option value="system">System Audio (Screen Share)</option>
            <option value="off">Off (Silence)</option>
        </select>
    </div>
    <div style="padding: 10px; border-bottom: 1px solid #444; background: #2d2d2d;">
        <button id="openFolderBtn" style="width:100%; background:#0e639c; color:white; border:none; padding:5px; cursor:pointer; pointer-events: auto;">Open Wallpaper Folder</button>
    </div>
    <div style="padding: 15px; overflow-y: auto; flex: 1; color: #ccc;" id="propsPanel">
        <div style="color:#666; text-align:center; margin-top:20px;">Loading config...</div>
    </div>
</div>
<button id="sidebar-open-btn" style="top: 10px; left: 10px; z-index: 100002; background: #333; color: #ccc; border: 1px solid #444; padding: 5px 10px; cursor: pointer; display: none; pointer-events: auto;">
    ☰
</button>
`;

const SIDEBAR_JS_LOGIC = `
    function getSafeValue(p) {
        if (p.value !== undefined && p.value !== null) return p.value;
        if (p.default !== undefined && p.default !== null) return p.default;
        if (p.type === 'color') return "1 1 1";
        if (p.type === 'slider') return p.min || 0;
        if (p.type === 'bool') return false;
        if (p.type === 'combo') return (p.options && p.options[0] && p.options[0].value) || "";
        return "";
    }

    function weColorToHex(str) {
        if (!str || typeof str !== 'string') return '#ffffff';
        const parts = str.split(' ').map(parseFloat);
        if (parts.length < 3) return '#ffffff';
        const toHex = (n) => {
            const hex = Math.floor(Math.min(1,Math.max(0,n)) * 255).toString(16);
            return hex.length === 1 ? '0' + hex : hex;
        };
        return '#' + toHex(parts[0]) + toHex(parts[1]) + toHex(parts[2]);
    }

    function renderUI(json) {
        const panel = document.getElementById('propsPanel');
        panel.innerHTML = '';
        const props = json.properties || (json.general && json.general.properties) || {};
        
        Object.keys(props).forEach(key => {
            const p = props[key];
            const safeVal = getSafeValue(p);

            const div = document.createElement('div');
            div.className = 'control-item';
            const lbl = document.createElement('label');
            lbl.innerText = p.text || key;
            div.appendChild(lbl);

            let input;
            if (p.type === 'slider') {
                const valSpan = document.createElement('span');
                valSpan.className = 'val';
                valSpan.innerText = safeVal;
                lbl.appendChild(valSpan);
                input = document.createElement('input');
                input.type = 'range';
                input.min = p.min ?? 0; input.max = p.max ?? 100; input.step = p.step ?? 1;
                input.value = safeVal;
                input.oninput = (e) => {
                    let v = parseFloat(e.target.value);
                    if (p.step % 1 !== 0) v = parseFloat(v.toFixed(2));
                    valSpan.innerText = v;
                    updateProp(key, v);
                };
            } else if (p.type === 'color') {
                input = document.createElement('input');
                input.type = 'color';
                input.value = weColorToHex(safeVal);
                input.oninput = (e) => {
                    const h = e.target.value;
                    const r = parseInt(h.substr(1,2), 16)/255;
                    const g = parseInt(h.substr(3,2), 16)/255;
                    const b = parseInt(h.substr(5,2), 16)/255;
                    updateProp(key, \`\${r.toFixed(3)} \${g.toFixed(3)} \${b.toFixed(3)}\`);
                };
            } else if (p.type === 'bool') {
                input = document.createElement('input');
                input.type = 'checkbox';
                input.style.width = 'auto';
                input.checked = safeVal;
                input.onchange = (e) => updateProp(key, e.target.checked);
            } else if (p.type === 'combo') {
                input = document.createElement('select');
                (p.options || []).forEach(opt => {
                    const o = document.createElement('option');
                    o.value = opt.value;
                    o.innerText = opt.label;
                    if (opt.value == safeVal) o.selected = true;
                    input.appendChild(o);
                });
                input.onchange = (e) => updateProp(key, e.target.value);
            } else {
                input = document.createElement('input');
                input.type = 'text';
                input.value = safeVal;
                input.onchange = (e) => updateProp(key, e.target.value);
            }

            if (input) {
                div.appendChild(input);
                panel.appendChild(div);
            }
        });
    }

    // Audio Logic
    let audioContext;
    let analyser;
    let dataArray;
    let micStream;
    let audioSourceType = 'off';

    const audioSelect = document.getElementById('audioSource');
    
    function setAudioSource(val) {
        audioSourceType = val;
        if (audioSelect) audioSelect.value = val;
        if (audioSourceType === 'mic') initMic();
        else if (audioSourceType === 'system') initSystemAudio();
        else stopAudio();
    }

    if (audioSelect) {
        audioSelect.onchange = (e) => setAudioSource(e.target.value);
    }

    // Listen for requests from Iframe (forwarded from Settings Panel)
    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'CHANGE_AUDIO_SOURCE') {
            console.log("[Sidebar] Received audio source change request:", e.data.source);
            setAudioSource(e.data.source);
        }
    });

    async function initMic() {
        stopAudio();
        if (audioContext) return;
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            micStream = stream;
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 128; 
            source.connect(analyser);
            dataArray = new Uint8Array(analyser.frequencyBinCount);
        } catch (e) {
            console.error("Mic Error:", e);
            if (audioSelect) audioSelect.value = 'simulate';
            audioSourceType = 'simulate';
        }
    }

    async function initSystemAudio() {
        stopAudio();
        if (audioContext) return;
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
            micStream = stream;
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            analyser = audioContext.createAnalyser();
            analyser.fftSize = 128; 
            source.connect(analyser);
            dataArray = new Uint8Array(analyser.frequencyBinCount);
        } catch (e) {
            console.error("System Audio Error:", e);
            if (audioSelect) audioSelect.value = 'simulate';
            audioSourceType = 'simulate';
        }
    }

    function stopAudio() {
        if (micStream) {
            micStream.getTracks().forEach(t => t.stop());
            micStream = null;
        }
        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }
        analyser = null;
    }

    function audioLoop() {
        let audioData = new Array(64).fill(0);
        
        if (audioSourceType === 'simulate') {
            const t = Date.now() / 1000;
            for(let i=0; i<64; i++) {
                let v = Math.max(0, Math.sin(i*0.1 + t*10) * 0.8);
                v *= (1 - i/64);
                v += Math.random() * 0.2; 
                audioData[i] = Math.min(1, v);
                audioData[i+64] = Math.min(1, v);
            }
        } else if ((audioSourceType === 'mic' || audioSourceType === 'system') && analyser) {
            analyser.getByteFrequencyData(dataArray);
            for (let i = 0; i < 64; i++) {
                if (i < dataArray.length) {
                    audioData[i] = dataArray[i] / 255.0;
                }
            }
        } else if (audioSourceType === 'off') {
            audioData.fill(0);
        }

        const finalData = new Array(128).fill(0);
        for (let i = 0; i < 64; i++) {
            finalData[i*2] = audioData[i];
            finalData[i*2+1] = audioData[i];
        }
        
        if (typeof el !== 'undefined' && el && el.contentWindow) {
            el.contentWindow.postMessage({ type: 'AUDIO_TICK', data: finalData }, '*');
        }

        requestAnimationFrame(audioLoop);
    }
    audioLoop();
`;