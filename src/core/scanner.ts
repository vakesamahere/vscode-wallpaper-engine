import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WallpaperType } from './types';

// 定义壁纸数据模型
export class WallpaperItem implements vscode.QuickPickItem {
    label: string;
    description: string;
    detail: string;
    dirPath: string;
    type: WallpaperType;
    
    constructor(title: string, id: string, file: string, dirPath: string, type: WallpaperType) {
        this.label = `$(device-camera-video) ${title}`;
        this.description = `ID: ${id} [${type}]`;
        this.detail = file;
        this.dirPath = dirPath;
        this.type = type;
    }

    getMediaPath(): { path: string, type: WallpaperType } {
        let mainFile = this.detail;
        let finalPath = path.join(this.dirPath, mainFile);

        // 针对 Image 类型的特殊处理：如果主文件不是常见图片格式，尝试使用 preview.jpg
        if (this.type === WallpaperType.Image && !mainFile.match(/\.(jpg|jpeg|png)$/i)) {
            const preview = path.join(this.dirPath, 'preview.jpg');
            if (fs.existsSync(preview)) {
                finalPath = preview;
            }
        }
        return { path: finalPath, type: this.type };
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
                const rawType = json.type ? json.type.toLowerCase() : '';
                
                // 过滤类型
                let type: WallpaperType | null = null;
                if (rawType === 'video') { type = WallpaperType.Video; }
                else if (rawType === 'image') { type = WallpaperType.Image; }
                else if (rawType === 'web') { type = WallpaperType.Web; }

                if (json.file && type) {
                    items.push(new WallpaperItem(
                        json.title || '未命名', 
                        dir, 
                        json.file, 
                        path.join(workshopPath, dir),
                        type
                    ));
                }
            } catch (e) { }
        }
    }
    return items;
}