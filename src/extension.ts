// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfiguration, validateConfig } from './config';
import { scanWallpapers, getWallpaperById } from './core/scanner';
import { performInjection, restoreWorkbench, isPatched } from './core/injector';
import { WallpaperServer } from './core/server';
import { WallpaperType } from './core/types';
import { WALLPAPER_SERVER_PORT } from './config/constants';
import { applyTransparencyPatch, removeTransparencyPatch } from './core/config-patcher';
import { SettingsPanel } from './panels/setting-panel';

// test
import { openTestPage } from './playground/page';

const SHOW_DEBUG_SIDEBAR = false; // [Dev] Toggle Debug Sidebar

let server: WallpaperServer | undefined;
let isSettingWallpaper = false;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "vscode-wallpaper-engine" is now active!');
    
    server = new WallpaperServer(context);
    const initialConfig = getConfiguration();
    server.start(context.globalState.get<string>('currentWallpaperPath') || '', initialConfig.serverPort);

    const applyWallpaper = async (forceReload = false, silent = false) => {
        const config = getConfiguration();
        if (!config.wallpaperId || !config.workshopPath) {
            if (!silent) {
                vscode.window.showWarningMessage('Please select a wallpaper and configure workshop path first to apply settings.');
            }
            return; 
        }

        const item = getWallpaperById(config.workshopPath, config.wallpaperId);
        if (item) {
            const { path: filePath, type } = item.getMediaPath();
            const dirPath = path.dirname(filePath);
            const fileName = path.basename(filePath);
            
            if (server) {
                await server.start(dirPath, config.serverPort, fileName);
                server.updateCssConfig({
                    customCss: config.customCss
                });
            }

            await performInjection(filePath, WallpaperType.Web, config.opacity, config.serverPort, config.customJs, config.resizeDelay, config.startupCheckInterval, false, SHOW_DEBUG_SIDEBAR);
            
            // Apply transparency patch
            await applyTransparencyPatch();
            
            if (silent) { return; }

            if (forceReload) {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            } else {
                const action = await vscode.window.showInformationMessage('Wallpaper Engine settings changed. Restart to apply?', 'Restart');
                if (action === 'Restart') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            }
        }
    };

    // Watch for config changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async e => {
        if (isSettingWallpaper) { return; }
        
        const affectsId = e.affectsConfiguration('vscode-wallpaper-engine.wallpaperId');
        const affectsOthers = 
            e.affectsConfiguration('vscode-wallpaper-engine.backgroundOpacity') ||
            e.affectsConfiguration('vscode-wallpaper-engine.serverPort') ||
            e.affectsConfiguration('vscode-wallpaper-engine.customJs') ||
            e.affectsConfiguration('vscode-wallpaper-engine.resizeDelay') ||
            e.affectsConfiguration('vscode-wallpaper-engine.startupCheckInterval') ||
            e.affectsConfiguration('vscode-wallpaper-engine.transparentOpacity') ||
            e.affectsConfiguration('vscode-wallpaper-engine.transparentCss') ||
            e.affectsConfiguration('vscode-wallpaper-engine.customCss');

        if (affectsId && !affectsOthers) {
             const config = getConfiguration();
             if (config.wallpaperId && config.workshopPath) {
                const item = getWallpaperById(config.workshopPath, config.wallpaperId);
                if (item && server) {
                    await applyWallpaper(false, true);
                    return;
                }
             }
        }

        if (affectsId || affectsOthers) {
            await applyWallpaper();
        }
    }));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-wallpaper-engine.refreshWallpaper', async () => {
        if (server) {
            server.triggerReload();
            vscode.window.showInformationMessage('Refreshing wallpaper...');
        }
    }));

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerCommand('vscode-wallpaper-engine.helloWorld', () => {
		openTestPage();    
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
                isSettingWallpaper = true;
                try {
                    // Update config
                    await vscode.workspace.getConfiguration('vscode-wallpaper-engine').update('wallpaperId', selected.id, vscode.ConfigurationTarget.Global);

                    const { path: filePath, type } = selected.getMediaPath();
                    const dirPath = path.dirname(filePath);
                    const fileName = path.basename(filePath);
                    
                    if (server) {
                        await server.start(dirPath, config.serverPort, fileName);
                        server.updateCssConfig({
                            customCss: config.customCss
                        });
                    }
                    
                    // Pass autoRestart=false because we handle reload via ping
                    await performInjection(filePath, WallpaperType.Web, config.opacity, config.serverPort, config.customJs, config.resizeDelay, config.startupCheckInterval, false, SHOW_DEBUG_SIDEBAR);
                } finally {
                    setTimeout(() => { isSettingWallpaper = false; }, 2000);
                }
            }
        });
    });
	context.subscriptions.push(setWallPaperCmd);

    const openInBrowserCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.openInBrowser', async () => {
        const config = getConfiguration();
        const url = `http://127.0.0.1:${config.serverPort}/index.html`;
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
            await removeTransparencyPatch();
            server?.stop();
        }
    });
    context.subscriptions.push(uninstallCmd);

    context.subscriptions.push(vscode.commands.registerCommand('vscode-wallpaper-engine.openSettings', () => {
        if (server) {
            vscode.window.showInformationMessage(`context.extensionUri: ${context.extensionUri}`);
            SettingsPanel.createOrShow(context.extensionUri, server);
        } else {
            vscode.window.showErrorMessage('Wallpaper Server is not running.');
        }
    }));

    // Edit Custom CSS Command
    const cssStoragePath = path.join(context.globalStorageUri.fsPath, 'custom.css');
    const editCustomCssCmd = vscode.commands.registerCommand('vscode-wallpaper-engine.editCustomCss', async () => {
        const config = getConfiguration();
        const cssContent = config.customCss || '/* Enter your custom CSS here */';
        
        if (!fs.existsSync(context.globalStorageUri.fsPath)) {
            fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
        }
        
        fs.writeFileSync(cssStoragePath, cssContent, 'utf-8');
        
        const doc = await vscode.workspace.openTextDocument(cssStoragePath);
        await vscode.window.showTextDocument(doc);
    });
    context.subscriptions.push(editCustomCssCmd);

    // Listen for CSS file save
    context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (path.normalize(doc.fileName) === path.normalize(cssStoragePath)) {
            const content = doc.getText();
            const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
            await config.update('customCss', content, vscode.ConfigurationTarget.Global);
            
            if (server) {
                const currentConfig = getConfiguration();
                server.updateCssConfig({
                    customCss: content
                });
                server.triggerReload();
                vscode.window.setStatusBarMessage('Wallpaper CSS Updated', 2000);
            }
        }
    }));
}

// This method is called when your extension is deactivated
export function deactivate() {
    server?.stop();
}
