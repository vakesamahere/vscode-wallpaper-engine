import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';

export default async function modifyDom() {
  const appPath = vscode.env.appRoot;
//   await testModifyDom();
  await setWallPaper();
}

async function testModifyDom() {
    const cssPath = path.join(vscode.env.appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
    vscode.window.showInformationMessage(`CSS 文件路径: ${cssPath}`);
    const myCss = `
        /* [VSCode-Wallpaper-Engine-Injection-Start] */
        body {
            background-image: url('https://media.giphy.com/media/26tn33aiU1UfKD3Ko/giphy.gif'); /* 测试用动图 */
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            opacity: 0.9; 
        }
        /* 核心：必须把工作台背景变透明，否则看不到底下的图 */
        .monaco-workbench {
            background-color: rgba(255, 255, 255, 0.0) !important;
        }
        /* [VSCode-Wallpaper-Engine-Injection-End] */
        `;

    try {
        // 3. 读取当前文件内容
        let content = fs.readFileSync(cssPath, 'utf-8');

        // 4. 检查是否已经安装过，防止重复写入
        if (content.includes('[VSCode-Wallpaper-Engine-Injection-Start]')) {
            vscode.window.showInformationMessage('壁纸补丁已经安装过了！');
        } else {
            // 5. 写入文件 (追加模式)
            fs.writeFileSync(cssPath, content + myCss, 'utf-8');
            // 将文件内容保存到日志中，便于调试
            console.log('Modified CSS Content:', content + myCss);
        }

        // 6. 提示重启
        const selection = await vscode.window.showInformationMessage('壁纸注入成功！需要重启窗口生效。', '立即重启');
        if (selection === '立即重启') {
            // 调用 VS Code 内部命令重启窗口
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }

    } catch (error) {
        // 错误处理：通常是权限问题
        console.error(error);
        vscode.window.showErrorMessage('写入失败！请尝试【以管理员身份运行 VS Code】后再试。错误信息: ' + error);
    }
}

async function setWallPaper() {
    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
    const workshopPath = config.get<string>('workshopPath');
    const opacity = config.get<number>('backgroundOpacity') || 0.8;

    // 1. 检查配置
    if (!workshopPath || !fs.existsSync(workshopPath)) {
        vscode.window.showErrorMessage('未配置正确的 Wallpaper Engine 路径！请去设置里检查。');
        return;
    }

    try {
        // 2. 随机挑选壁纸
        const wallpaperDirs = fs.readdirSync(workshopPath).filter(file => 
            fs.statSync(path.join(workshopPath, file)).isDirectory()
        );
        
        if (wallpaperDirs.length === 0) {
            vscode.window.showErrorMessage('路径下没找到壁纸文件夹');
            return;
        }

        // const randomDir = "827982449"; // image 测试
        const randomDir = "1769472360"; // video 测试
        const projectJsonPath = path.join(workshopPath, randomDir, 'project.json');
        
        let mediaType = 'image'; // 默认是图片
        let mediaPath = '';

        // 解析 project.json
        if (fs.existsSync(projectJsonPath)) {
            const projectConfig = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
            const mainFile = projectConfig.file || '';
            
            // 判断是否为视频
            if (mainFile.match(/\.(mp4|webm)$/i)) {
                mediaType = 'video';
                mediaPath = path.join(workshopPath, randomDir, mainFile);
            } else {
                // 如果不是视频，尝试找 preview.jpg，最后才找原文件
                const previewPath = path.join(workshopPath, randomDir, 'preview.jpg');
                if (fs.existsSync(previewPath)) {
                    mediaPath = previewPath;
                } else {
                    mediaPath = path.join(workshopPath, randomDir, mainFile);
                }
            }
        } else {
            // 没有 json 就随便盲猜一个 preview.jpg
            mediaPath = path.join(workshopPath, randomDir, 'preview.jpg');
        }

        // // 最终的 URL (file:///...)
        // const finalUrl = 'file:///' + formatPath(mediaPath);
        // 改用 vscode-file://vscode-app/...
        const finalUrl = toVsCodeResourceUrl(mediaPath);
        console.log(`[Wallpaper] 准备注入: ${mediaType} -> ${finalUrl}`);

        // 3. 注入 CSS (负责界面透明，不再负责背景图)
        const cssPath = path.join(vscode.env.appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.css');
        const cssContent = `
/* [VSCode-Wallpaper-Injection-Start] */
body {
    background-color: transparent !important;
}
/* 核心工作台背景透明 */
.monaco-workbench {
    background-color: rgba(0,0,0,0) !important;
}
/* 各个组件半透明，穿透看到底下的 Video */
.monaco-editor, .monaco-editor-background, 
.monaco-workbench .part.editor, 
.monaco-workbench .part.sidebar,
.monaco-workbench .part.panel,
.monaco-workbench .part.auxiliarybar,
.editor-group-container,
.editor-widget {
    background-color: rgba(26, 26, 26, ${opacity}) !important;
    background-image: none !important;
}
/* [VSCode-Wallpaper-Injection-End] */
`;

        let rawCss = fs.readFileSync(cssPath, 'utf-8');
        // 清除旧注入
        rawCss = rawCss.replace(/[\n\s\t]*?\/\* \[VSCode-Wallpaper-Injection-Start\] \*\/[\s\S]*?\/\* \[VSCode-Wallpaper-Injection-End\] \*\//g, '');
        fs.writeFileSync(cssPath, rawCss + cssContent, 'utf-8');


        // 4. 注入 JS (负责创建 Video/Img 标签到 DOM 最底层)
        const jsPath = path.join(vscode.env.appRoot, 'out', 'vs', 'workbench', 'workbench.desktop.main.js');
        
        // 这段 JS 字符串会被写入到 VS Code 启动文件中
        const jsInjection = `
        /* [VSCode-Wallpaper-Injection-Start] */
        (function() {
            try {
                // 移除旧元素
                const old = document.getElementById('vscode-wallpaper-bg');
                if (old) old.remove();

                // 创建新元素
                let el;
                if ("${mediaType}" === "video") {
                    el = document.createElement('video');
                    el.src = "${finalUrl}";
                    el.autoplay = true;
                    el.loop = true;
                    el.muted = true; // 必须静音，否则浏览器策略禁止自动播放
                    el.play().catch(e => console.error("Video play error:", e));
                } else {
                    el = document.createElement('img');
                    el.src = "${finalUrl}";
                }

                // 样式设置
                el.id = 'vscode-wallpaper-bg';
                el.style.position = 'absolute';
                el.style.top = '0';
                el.style.left = '0';
                el.style.width = '100%';
                el.style.height = '100%';
                el.style.objectFit = 'cover'; // 保持比例填充
                el.style.zIndex = '-1';       // 放在最底层
                el.style.opacity = '1';
                el.style.pointerEvents = 'none'; // 点击穿透

                document.body.appendChild(el);
                console.log("[Wallpaper] Background element injected.");

            } catch (e) {
                console.error("[Wallpaper] Injection error:", e);
            }
        })();
        /* [VSCode-Wallpaper-Injection-End] */
        `;

        let rawJs = fs.readFileSync(jsPath, 'utf-8');
        // 清除旧注入
        rawJs = rawJs.replace(/\/\* \[VSCode-Wallpaper-Injection-Start\] \*\/[\s\S]*?\/\* \[VSCode-Wallpaper-Injection-End\] \*\//g, '');
        fs.writeFileSync(jsPath, rawJs + jsInjection, 'utf-8');

        // 5. 提示用户
        const selection = await vscode.window.showInformationMessage(
            `壁纸注入完成 (${mediaType})！需要重启窗口生效。`, 
            '立即重启'
        );
        if (selection === '立即重启') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
        }

    } catch (error) {
        console.error(error);
        vscode.window.showErrorMessage('注入失败，可能是权限不足或路径错误: ' + error);
    }
}

// ======================================= utils =======================================

// 处理 Windows 路径，确保 JS 和 CSS 能识别
function formatPath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\s/g, '%20');
}

// 把本地路径转换为 VS Code 内部专用协议 URL
function toVsCodeResourceUrl(localPath: string): string {
    // 1. 使用 VS Code 自带的 URI 工具处理基本格式 (处理空格、编码等)
    const uri = vscode.Uri.file(localPath);
    
    // 2. 关键魔法：把 file:// 替换为 vscode-file://vscode-app
    // 这样 VS Code 就会以为这是它自己的内部文件
    return uri.toString().replace('file://', 'vscode-file://vscode-app');
}