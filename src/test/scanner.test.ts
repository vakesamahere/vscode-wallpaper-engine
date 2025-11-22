import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanWallpapers } from '../core/scanner';
import { WallpaperType } from '../core/types';

suite('Scanner Test Suite', () => {
    let tempDir: string;

    setup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vscode-wallpaper-test-'));
    });

    teardown(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error('Failed to clean up temp dir:', e);
        }
    });

    test('scanWallpapers should find valid wallpapers', () => {
        // Create a valid wallpaper dir
        const wpDir = path.join(tempDir, '12345');
        fs.mkdirSync(wpDir);
        fs.writeFileSync(path.join(wpDir, 'project.json'), JSON.stringify({
            title: 'Test Wallpaper',
            file: 'video.mp4',
            type: 'video'
        }));

        const items = scanWallpapers(tempDir);
        assert.strictEqual(items.length, 1);
        assert.strictEqual(items[0].label, '$(device-camera-video) Test Wallpaper');
        assert.strictEqual(items[0].type, WallpaperType.Video);
    });

    test('scanWallpapers should ignore invalid types', () => {
        const wpDir = path.join(tempDir, '67890');
        fs.mkdirSync(wpDir);
        fs.writeFileSync(path.join(wpDir, 'project.json'), JSON.stringify({
            title: 'Invalid Wallpaper',
            file: 'scene.pkg',
            type: 'unknown_type' // Not in allowed list
        }));

        const items = scanWallpapers(tempDir);
        assert.strictEqual(items.length, 0);
    });
    
    test('scanWallpapers should handle missing project.json', () => {
        const wpDir = path.join(tempDir, 'empty');
        fs.mkdirSync(wpDir);
        
        const items = scanWallpapers(tempDir);
        assert.strictEqual(items.length, 0);
    });

    test('scanWallpapers should handle malformed project.json', () => {
        const wpDir = path.join(tempDir, 'malformed');
        fs.mkdirSync(wpDir);
        fs.writeFileSync(path.join(wpDir, 'project.json'), '{ invalid json ');

        const items = scanWallpapers(tempDir);
        assert.strictEqual(items.length, 0);
    });
});
