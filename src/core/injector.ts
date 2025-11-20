import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { toVsCodeResourceUrl } from '../utils'; 
import { saveFilePrivileged } from './admin-saver';

// --- 常量定义 ---

// 注入标记
const JS_INJECTION_REGEX = /\s*\/\* \[VSCode-Wallpaper-Injection-Start\] \*\/[\s\S]*?\/\* \[VSCode-Wallpaper-Injection-End\] \*\//g;
const HTML_INJECTION_REGEX = /\s*<!-- VSCode-Wallpaper-Injection-Start -->[\s\S\n]*?<!-- VSCode-Wallpaper-Injection-End -->/g;

// HTML 新 CSP 标记
const CSP_MARKER_START = '<!-- VSCode-Wallpaper-Injection-Start -->';
const CSP_MARKER_END = '<!-- VSCode-Wallpaper-Injection-End -->';

// 属性重命名策略
const ATTR_ORIGINAL = 'http-equiv="Content-Security-Policy"';
const ATTR_RENAMED = 'http-equiv="Content-Security-Policy--replaced-by-wallpaper-engine-plugin"';

// 获取 workbench 核心文件路径
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
        if (fs.existsSync(fullPath)) return fullPath;
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
    if (!targetHtml) return;

    let html = fs.readFileSync(targetHtml, 'utf-8');

    // 检查是否已经 Patch 过
    if (html.includes(ATTR_RENAMED)) {
        return; // 已经重命名过了，无需重复操作
    }

    // 1. 匹配整个原版 meta 标签
    // 使用 [\s\S\n]*? 跨行匹配，确保捕获完整的标签
    const metaTagRegex = /<meta[\s\S\n]*?http-equiv="Content-Security-Policy"[\s\S\n]*?>/i;
    const match = html.match(metaTagRegex);

    if (!match) {
        console.warn("未找到 CSP 标签，无法 Patch");
        return;
    }

    const originalTag = match[0];

    // 2. 构造“失效版”标签 (仅重命名属性)
    // 注意：这里使用字符串替换，只替换 http-equiv 部分
    const disabledTag = originalTag.replace(ATTR_ORIGINAL, ATTR_RENAMED);

    // 3. 构造“新版”标签 (基于原版修改)
    let newTagContent = originalTag;
    
    // A. 移除 Trusted Types 限制
    newTagContent = newTagContent.replace(/require-trusted-types-for[\s\S]*?'script'[\s\S]*?;/g, '');

    // B. 注入宽松规则到 content 属性
    const contentRegex = /content="([\s\S]*?)"/i;
    const contentMatch = newTagContent.match(contentRegex);
    
    if (contentMatch) {
        const oldContent = contentMatch[1];
        // 宽松规则：允许 vscode-file, file, data 等
        const looseRules = `default-src * 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob:; frame-src * vscode-file: file: data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' vscode-file: file: data: blob:; `;
        const newContent = `${looseRules}${oldContent}`;
        newTagContent = newTagContent.replace(contentRegex, `content="${newContent}"`);
    }

    // 4. 组合最终 HTML
    // 结构: [失效的原标签] + [新标签块]
    const injectionBlock = `
${disabledTag}
${CSP_MARKER_START}
${newTagContent}
${CSP_MARKER_END}
`;

    console.log("正在应用 HTML Patch (Renaming Strategy)...");
    
    // 替换原标签
    html = html.replace(originalTag, injectionBlock);
    
    await saveFilePrivileged(targetHtml, html);
}

// --- JS 注入逻辑 ---

const MOCK_API_SCRIPT = `
<script>
(function() {
    try {
        window.wallpaperRequestRandomFileForProperty = function() {};
        window.wallpaperRegisterAudioListener = function() {};
        window.wallpaperRegisterMediaStatusListener = function() {};
        window.wallpaperRegisterMediaPropertiesListener = function() {};
        window.wallpaperRegisterMediaTimelineListener = function() {};
        window.wallpaperPropertyListener = {
            applyUserProperties: function(props) {},
            applyGeneralProperties: function(props) {},
            setPaused: function(paused) {}
        };
        setTimeout(() => {
            if (window.wallpaperPropertyListener && window.wallpaperPropertyListener.applyGeneralProperties) {
                window.wallpaperPropertyListener.applyGeneralProperties({ fps: 60 });
            }
        }, 500);
    } catch(e) { console.error("Mock API Error", e); }
})();
</script>
`;

async function injectJs(mediaPath: string, type: 'video'|'image'|'web', opacity: number) {
    const jsPath = getWorkbenchPath('js');
    if (!jsPath) return;
    
    let elementCreationCode = '';

    if (type === 'video') {
        const finalUrl = toVsCodeResourceUrl(mediaPath);
        elementCreationCode = `
            el = document.createElement('video');
            el.src = "${finalUrl}";
            el.autoplay = true;
            el.loop = true;
            el.muted = true;
            el.play();
        `;
    } else if (type === 'image') {
        const finalUrl = toVsCodeResourceUrl(mediaPath);
        elementCreationCode = `
            el = document.createElement('img');
            el.src = "${finalUrl}";
        `;
    } else if (type === 'web') {
        let htmlContent = fs.readFileSync(mediaPath, 'utf-8');
        const dirPath = path.dirname(mediaPath);
        const baseUrl = toVsCodeResourceUrl(dirPath) + '/';
        const baseTag = `<base href="${baseUrl}" />`;
        
        if (htmlContent.includes('<head>')) {
            htmlContent = htmlContent.replace('<head>', `<head>${baseTag}${MOCK_API_SCRIPT}`);
        } else {
            htmlContent = `${baseTag}${MOCK_API_SCRIPT}${htmlContent}`;
        }

        const safeHtmlString = JSON.stringify(htmlContent);
        elementCreationCode = `
            el = document.createElement('iframe');
            el.srcdoc = ${safeHtmlString};
            el.frameBorder = '0';
            el.allow = "autoplay; fullscreen"; 
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
        container.style.opacity = '${opacity}';

        let el;
        ${elementCreationCode}

        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';
        
        if (el.tagName === 'IFRAME') {
             el.style.border = 'none';
             el.style.display = 'block';
             el.style.pointerEvents = 'none'; 
             el.onload = function() { console.log('Wallpaper Loaded'); }
        }

        container.appendChild(el);
        document.body.appendChild(container);

    } catch (e) { console.error("Wallpaper Engine Error:", e); }
})();
/* [VSCode-Wallpaper-Injection-End] */`;

    try {
        let raw = fs.readFileSync(jsPath, 'utf-8');
        // 清理旧注入
        raw = raw.replace(JS_INJECTION_REGEX, '');
        await saveFilePrivileged(jsPath, raw + jsInjection);
    } catch (e) {
        throw new Error(`JS 注入失败: ${e}`);
    }
}

export async function performInjection(mediaPath: string, type: 'video'|'image'|'web', opacity: number) {
    try {
        // 1. Patch HTML
        await patchWorkbenchHtml();
        
        // 2. 注入 JS
        await injectJs(mediaPath, type, opacity);
        
        const action = await vscode.window.showInformationMessage('注入成功！重启生效。', '立即重启');
        if (action === '立即重启') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(error.message || String(error));
    }
}

// 辅助函数：正则字符串转义
function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); 
}