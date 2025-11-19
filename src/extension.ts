// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { getConfiguration, validateConfig } from './config';
import { scanWallpapers } from './core/scanner';
import { performInjection } from './core/injector';

// test
import modifyDom from './playground/modify_dom';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-wallpaper-engine" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('vscode-wallpaper-engine.helloWorld', async () => {
		await modifyDom();
	});
	context.subscriptions.push(disposable);

	// command to set wallpaper
	const setWallPaperCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.installWallpaper', async () => {
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
                // 4. 核心操作
                const { path, isVideo } = selected.getMediaPath();
                await performInjection(path, isVideo, config.opacity);
            }
        });
    });
	context.subscriptions.push(setWallPaperCmd);
}

// This method is called when your extension is deactivated
export function deactivate() {}
