import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { toVsCodeResourceUrl } from '../utils'; 
import { saveFilePrivileged } from './admin-saver';

// 注入标记
const INJECTION_REGEX = /\s*\/\* \[VSCode-Wallpaper-Injection-Start\] \*\/[\s\S]*?\/\* \[VSCode-Wallpaper-Injection-End\] \*\//g;

// 注入 JS，创建一个顶层容器
async function injectJs(mediaPath: string, isVideo: boolean, opacity: number) {
    const jsPath = path.join(vscode.env.appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
    const finalUrl = toVsCodeResourceUrl(mediaPath);
    
    // 构造 JS 注入脚本
    const jsInjection = `
/* [VSCode-Wallpaper-Injection-Start] */
(function() {
    try {
        // 1. 清理旧容器
        const oldContainer = document.getElementById('vscode-wallpaper-container');
        if (oldContainer) oldContainer.remove();
        // 兼容旧版本的 id
        const oldBg = document.getElementById('vscode-wallpaper-bg');
        if (oldBg) oldBg.remove();

        // 2. 创建容器 (Container)
        // 以后如果想加 iframe 或其他特效，都往这个 div 里塞
        const container = document.createElement('div');
        container.id = 'vscode-wallpaper-container';
        container.style.position = 'fixed'; // 使用 fixed 即使滚动条动它也不动
        container.style.top = '0'; 
        container.style.left = '0'; 
        container.style.width = '100%'; 
        container.style.height = '100%';
        container.style.zIndex = '99999'; // 【关键】放在最上层
        container.style.pointerEvents = 'none'; // 【关键】鼠标穿透
        container.style.opacity = '${opacity}'; // 【关键】透明度由用户控制 (建议 0.1 - 0.3)

        // 3. 创建媒体元素
        let el;
        if (${isVideo}) {
            el = document.createElement('video');
            el.src = "${finalUrl}";
            el.autoplay = true;
            el.loop = true;
            el.muted = true;
            el.play();
        } else {
            el = document.createElement('img');
            el.src = "${finalUrl}";
        }

        // 媒体元素充满容器
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';

        container.appendChild(el);
        document.body.appendChild(container);

    } catch (e) { console.error("Wallpaper Engine Error:", e); }
})();
/* [VSCode-Wallpaper-Injection-End] */`;

    try {
        let raw = fs.readFileSync(jsPath, 'utf-8');
        // 先清理，再写入
        raw = raw.replace(INJECTION_REGEX, '');
        await saveFilePrivileged(jsPath, raw + jsInjection);
    } catch (e) {
        throw new Error(`JS 注入失败: ${e}`);
    }
}

export async function performInjection(mediaPath: string, isVideo: boolean, opacity: number) {
    try {
        await injectJs(mediaPath, isVideo, opacity);
        
        const action = await vscode.window.showInformationMessage('壁纸已更新，需要重启窗口。', '立即重启');
        if (action === '立即重启') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(error.message || String(error));
    }
}