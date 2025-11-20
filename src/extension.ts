// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { getConfiguration, validateConfig } from './config';
import { scanWallpapers } from './core/scanner';
import { performInjection, restoreWorkbench } from './core/injector';
import { WallpaperServer } from './core/server';
import { WallpaperType } from './core/types';
import { WALLPAPER_SERVER_PORT } from './config/constants';

// test
import modifyDom from './playground/modify_dom';

let server: WallpaperServer | undefined;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-wallpaper-engine" is now active!');
    
    server = new WallpaperServer(context);
    server.start(context.globalState.get<string>('currentWallpaperPath') || '');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('vscode-wallpaper-engine.helloWorld', async () => {
		await modifyDom();
	});
	context.subscriptions.push(disposable);

	// command to set wallpaper
	const setWallPaperCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.setWallpaper', async () => {
        // 1. 配置
        const config = getConfiguration();
        if (!validateConfig(config)) {
            return;
        }

        // 2. 扫描
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "正在读取 Wallpaper Engine 库...",
            cancellable: false
        }, async () => {
            
            const items = scanWallpapers(config.workshopPath);

            if (items.length === 0) {
                vscode.window.showInformationMessage('未找到任何壁纸，请检查路径。');
                return;
            }

            // 3. 交互
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '选择一个壁纸 (支持搜索)',
                matchOnDescription: true
            });

            if (selected) {
                const { path: filePath, type } = selected.getMediaPath();
                
                // 如果是 Web 类型，我们需要通知 Server 切换目录
                if (type === WallpaperType.Web) {
                    // 获取壁纸所在的文件夹目录
                    const dirPath = path.dirname(filePath);
                    if (server) {
                        await server.start(dirPath); 
                    }
                }
                
                await performInjection(filePath, type, config.opacity);
            }
        });
    });
	context.subscriptions.push(setWallPaperCmd);

    const openInBrowserCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.openInBrowser', async () => {
        const url = `http://127.0.0.1:${WALLPAPER_SERVER_PORT}/index.html`;
        await vscode.env.openExternal(vscode.Uri.parse(url));
    });
    context.subscriptions.push(openInBrowserCmd);

    const uninstallCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.uninstallWallpaper', async () => {
        const confirm = await vscode.window.showWarningMessage(
            '确定要卸载 Wallpaper Engine 插件吗？这将移除所有注入的代码和修改。',
            { modal: true },
            '卸载'
        );
        if (confirm === '卸载') {
            await restoreWorkbench();
            server?.stop();
        }
    });
    context.subscriptions.push(uninstallCmd);
}

// This method is called when your extension is deactivated
export function deactivate() {
    server?.stop();
}
