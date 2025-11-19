import * as vscode from 'vscode';
import * as fs from 'fs';

export interface AppConfig {
    workshopPath: string;
    opacity: number;
}

export function getConfiguration(): AppConfig {
    const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
    const workshopPath = config.get<string>('workshopPath') || '';
    const opacity = config.get<number>('backgroundOpacity') || 0.3;

    return { workshopPath, opacity };
}

export function validateConfig(config: AppConfig): boolean {
    if (!config.workshopPath || !fs.existsSync(config.workshopPath)) {
        vscode.window.showErrorMessage('请先在设置中配置正确的 Wallpaper Engine 创意工坊目录！');
        return false;
    }
    return true;
}