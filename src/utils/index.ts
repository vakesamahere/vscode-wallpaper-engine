import * as vscode from 'vscode';

// 把本地路径转换为 VS Code 内部专用协议 URL (vscode-file://)
export function toVsCodeResourceUrl(localPath: string): string {
    const uri = vscode.Uri.file(localPath);
    return uri.toString().replace('file://', 'vscode-file://vscode-app');
}