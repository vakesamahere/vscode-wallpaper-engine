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
    id: string;
    location: string;
    
    constructor(title: string, id: string, file: string, dirPath: string, type: WallpaperType, location?: string) {
        this.label = `$(device-camera-video) ${title}`;
        this.description = `ID: ${id} [${type}]`;
        this.detail = file;
        this.dirPath = dirPath;
        this.type = type;
        this.id = id;
        this.location = location || dirPath;
    }

    getMediaPath(): { path: string, type: WallpaperType } {
        let mainFile = this.detail || 'index.html'; // Fallback
        let finalPath = path.join(this.location, mainFile); // Use location instead of dirPath

        // 针对 Image 类型的特殊处理：如果主文件不是常见图片格式，尝试使用 preview.jpg
        if (this.type === WallpaperType.Image && !mainFile.match(/\.(jpg|jpeg|png)$/i)) {
            const preview = path.join(this.location, 'preview.jpg');
            if (fs.existsSync(preview)) {
                finalPath = preview;
            }
        }
        return { path: finalPath, type: this.type };
    }
}

function resolveWallpaperInfo(workshopPath: string, id: string, visited = new Set<string>()): { type: WallpaperType, file: string, location: string } | null {
    if (visited.has(id)) return null;
    visited.add(id);

    const dirPath = path.join(workshopPath, id);
    const projectJsonPath = path.join(dirPath, 'project.json');
    if (!fs.existsSync(projectJsonPath)) return null;

    try {
        const json = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
        const rawType = json.type ? json.type.toLowerCase() : '';
        let type: WallpaperType | null = null;

        if (rawType === 'video') type = WallpaperType.Video;
        else if (rawType === 'image') type = WallpaperType.Image;
        else if (rawType === 'web' || rawType === 'scene') type = WallpaperType.Web;

        let file = json.file || null;

        if (type) {
            return { type, file: file || 'index.html', location: dirPath };
        }

        // Try dependency
        if (json.dependency) {
            const depInfo = resolveWallpaperInfo(workshopPath, json.dependency, visited);
            if (depInfo) {
                return { type: depInfo.type, file: file || depInfo.file, location: depInfo.location };
            }
        }
    } catch (e) {}
    return null;
}

export function scanWallpapers(workshopPath: string): WallpaperItem[] {
    const wallpaperDirs = fs.readdirSync(workshopPath).filter(file => 
        fs.statSync(path.join(workshopPath, file)).isDirectory()
    );

    const items: WallpaperItem[] = [];

    for (const dir of wallpaperDirs) {
        const info = resolveWallpaperInfo(workshopPath, dir);
        if (info) {
            const projectJsonPath = path.join(workshopPath, dir, 'project.json');
            try {
                const json = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
                items.push(new WallpaperItem(
                    json.title || '未命名', 
                    dir, 
                    info.file, 
                    path.join(workshopPath, dir),
                    info.type,
                    info.location
                ));
            } catch (e) {}
        }
    }
    return items;
}

export function getWallpaperById(workshopPath: string, id: string): WallpaperItem | null {
    const info = resolveWallpaperInfo(workshopPath, id);
    if (info) {
        const dirPath = path.join(workshopPath, id);
        const projectJsonPath = path.join(dirPath, 'project.json');
        try {
            const json = JSON.parse(fs.readFileSync(projectJsonPath, 'utf-8'));
            return new WallpaperItem(
                json.title || '未命名', 
                id, 
                info.file, 
                dirPath,
                info.type,
                info.location
            );
        } catch (e) {}
    }
    return null;
}