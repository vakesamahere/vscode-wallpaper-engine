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
const SERVER_PORT = WALLPAPER_SERVER_PORT;

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

${CSP_MARKER_END}
`;
    console.log("应用 CSP 补丁...");
    html = html.replace(originalTag, injectionBlock);
    await saveFilePrivileged(targetHtml, html);
}
async function injectJs(mediaPath: string, type: WallpaperType, opacity: number) {
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
        const targetUrl = `http://127.0.0.1:${SERVER_PORT}/index.html`;
        const pingUrl = `http://127.0.0.1:${SERVER_PORT}/ping`;
        
        elementCreationCode = `
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
            el.allow = "autoplay; fullscreen";
            el.style.opacity = '0'; // 初始隐藏
            el.style.transition = 'opacity 0.5s ease-in-out';
            const targetUrl = "${targetUrl}";
            
            async function checkHealthLoop() {
                await new Promise(resolve => setTimeout(resolve, 300));
                let isHealthy = false;
                try {
                    const resp = await fetch("${pingUrl}", { method: 'GET', mode: 'no-cors' });
                    isHealthy = true;
                } catch (e) {
                    console.warn("Wallpaper Engine: 等待服务器开启...", e);
                }
                if (!isHealthy) {
                    checkHealthLoop();
                } else {
                    el.src = targetUrl;
                    
                    // 加载完成后显示
                    el.onload = () => {
                        el.style.opacity = '${opacity}';
                        if (loader.parentNode) loader.remove();
                    };
                    
                    // 超时兜底 (3秒)
                    setTimeout(() => {
                        if (el.style.opacity === '0') {
                            el.style.opacity = '${opacity}';
                            if (loader.parentNode) loader.remove();
                        }
                    }, 3000);

                    monitorServer();
                }
            }

            async function monitorServer() {
                while(true) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    try {
                        await fetch("${pingUrl}", { method: 'GET', mode: 'no-cors' });
                    } catch(e) {
                        console.warn("Wallpaper Engine: 服务器断开，重新等待...");
                        el.style.opacity = '0'; // 隐藏 iframe
                        // 重新显示 loader? 也可以
                        container.appendChild(loader);
                        
                        el.src = 'about:blank';
                        checkHealthLoop();
                        break;
                    }
                }
            }
            checkHealthLoop();
        `;
    }

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
        container.style.zIndex = '99999';
        container.style.pointerEvents = 'none';
        container.style.opacity = '1';

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

        container.appendChild(el);
        document.body.appendChild(container);

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

export async function performInjection(mediaPath: string, type: WallpaperType, opacity: number) {
    try {
        await patchWorkbenchHtml();
        await injectJs(mediaPath, type, opacity);
        // 直接重启，无需用户确认
        vscode.window.setStatusBarMessage('Wallpaper installed. Restarting...', 5000);
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    } catch (error: any) {
        vscode.window.showErrorMessage(error.message || String(error));
    }
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}