import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 定义壁纸数据模型
export class WallpaperItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail: string;
    dirPath: string;
    
    constructor(title: string, id: string, file: string, dirPath: string) {
        this.label = `$(device-camera-video) ${title}`;
        this.description = `ID: ${id}`;
        this.detail = file;
        this.dirPath = dirPath;
    }

    getMediaPath(): { path: string, isVideo: boolean } {
        let mainFile = this.detail;
        let isVideo = false;
        let finalPath = path.join(this.dirPath, mainFile);

        if (mainFile.match(/\.(mp4|webm)$/i)) {
            isVideo = true;
        } else if (!mainFile.match(/\.(jpg|jpeg|png)$/i)) {
            const preview = path.join(this.dirPath, 'preview.jpg');
            if (fs.existsSync(preview)) {
                finalPath = preview;
            }
        }
        return { path: finalPath, isVideo };
    }
}

export function scanWallpapers(workshopPath: string): WallpaperItem[] {
    const wallpaperDirs = fs.readdirSync(workshopPath).filter(file => 
        fs.statSync(path.join(workshopPath, file)).isDirectory()
    );

    const items: WallpaperItem[] = [];

    for (const dir of wallpaperDirs) {
        const projectJsonPath = path.join(workshopPath, dir, 'project.json');
        if (fs.existsSync(projectJsonPath)) {
            try {
                const json = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
                if (json.file) {
                    items.push(new WallpaperItem(
                        json.title || '未命名', 
                        dir, 
                        json.file, 
                        path.join(workshopPath, dir)
                    ));
                }
            } catch (e) { }
        }
    }
    return items;
}