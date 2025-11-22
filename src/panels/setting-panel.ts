import * as vscode from 'vscode';
import * as fs from 'fs';
import { WallpaperServer } from '../core/server';

export class SettingsPanel {
    public static currentPanel: SettingsPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, private server: WallpaperServer) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getHtmlForWebview(this._panel.webview, extensionUri);
        this._setWebviewMessageListener(this._panel.webview);
    }

    public static createOrShow(extensionUri: vscode.Uri, server: WallpaperServer) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        if (SettingsPanel.currentPanel) {
            SettingsPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'wallpaperSettings',
            'Wallpaper Settings',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );

        SettingsPanel.currentPanel = new SettingsPanel(panel, extensionUri, server);
    }

    public dispose() {
        SettingsPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) { x.dispose(); }
        }
    }

    private _setWebviewMessageListener(webview: vscode.Webview) {
        webview.onDidReceiveMessage(
            (message: any) => {
                if (message.command === 'updateProp') {
                    this.server.broadcast({
                        type: 'UPDATE_PROPERTIES',
                        data: { [message.key]: { value: message.value } }
                    });
                } else if (message.command === 'updateGeneral') {
                    // Handle general settings (audio, mic, etc.)
                    // We'll send a specific message type for these
                    this.server.broadcast({
                        type: 'UPDATE_GENERAL',
                        data: { [message.key]: message.value }
                    });
                } else if (message.command === 'refresh') {
                    vscode.commands.executeCommand('vscode-wallpaper-engine.refreshWallpaper');
                } else if (message.command === 'switch') {
                    vscode.commands.executeCommand('vscode-wallpaper-engine.setWallpaper');
                } else if (message.command === 'openBrowser') {
                    vscode.commands.executeCommand('vscode-wallpaper-engine.openInBrowser');
                } else if (message.command === 'stopServer') {
                    this.server.stop();
                    vscode.window.showWarningMessage('Wallpaper Server stopped.');
                }
            },
            undefined,
            this._disposables
        );
    }

    private _getHtmlForWebview(webview: vscode.Webview, extensionUri: vscode.Uri) {
        const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
        const port = config.get<number>('serverPort') || 23333;

        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'settings.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'settings.css'));
        const htmlPath = vscode.Uri.joinPath(extensionUri, 'media', 'settings.html');
        
        let htmlContent = fs.readFileSync(htmlPath.fsPath, 'utf-8');

        htmlContent = htmlContent
            .replace(/{{cspSource}}/g, webview.cspSource)
            .replace(/{{styleUri}}/g, styleUri.toString())
            .replace(/{{scriptUri}}/g, scriptUri.toString())
            .replace(/{{serverPort}}/g, port.toString());

        return htmlContent;
    }
}
