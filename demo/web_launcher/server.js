const http = require('http');
const fs = require('fs');
const path = require('path');

// =====================================================================
// 🛠️ 配置区：填入 Wallpaper Engine 创意工坊的基础路径 (不包含具体ID)
// =====================================================================
const WORKSHOP_BASE_PATH = String.raw`C:\Program Files (x86)\Steam\steamapps\workshop\content\431960`;
// =====================================================================

const PORT = 23333;
const DEMO_ROOT = __dirname;

// 默认当前 ID (可以为空，等待前端设置)
let currentId = '';

const mimeTypes = {
    '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
    '.woff': 'font/woff', '.ttf': 'font/ttf'
};

const server = http.createServer((req, res) => {
    // 跨域头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

    let reqUrl = req.url.split('?')[0];

    // --- API: 设置当前壁纸 ID ---
    if (reqUrl === '/api/set-id' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const { id } = JSON.parse(body);
                const newPath = path.join(WORKSHOP_BASE_PATH, id);
                
                if (fs.existsSync(newPath)) {
                    currentId = id;
                    console.log(`[Server] Switched to ID: ${id} -> ${newPath}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, fullPath: newPath }));
                } else {
                    console.error(`[Server] ID not found: ${id}`);
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'ID directory does not exist' }));
                }
            } catch (e) {
                res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }

    // --- 静态文件路由 ---
    if (reqUrl === '/') reqUrl = '/host.html';

    let filePath;
    let sourceName = "";

    // 1. Demo 工具文件 (host.html, mock-api.js)
    if (reqUrl === '/host.html' || reqUrl === '/mock-api.js') {
        filePath = path.join(DEMO_ROOT, reqUrl.replace('/', ''));
        sourceName = "DEMO";
    } 
    // 2. 壁纸文件 (index.html, project.json 等)
    else {
        if (!currentId) {
            res.writeHead(404);
            res.end('No wallpaper ID selected. Use UI to set ID.');
            return;
        }
        // 路径 = 基础路径 + ID + 请求文件
        filePath = path.join(WORKSHOP_BASE_PATH, currentId, reqUrl);
        sourceName = `WP(${currentId})`;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            // console.error(`❌ [404] ${reqUrl}`); // 调试时可开启
            res.writeHead(404); res.end('Not Found');
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const mime = mimeTypes[ext] || 'application/octet-stream';
        
        // 只打印关键文件的请求日志
        if (ext === '.html' || ext === '.json') {
            console.log(`✅ [200] ${reqUrl} [${sourceName}]`);
        }
        
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log('===================================================');
    console.log(`🚀 Debugger: http://127.0.0.1:${PORT}/host.html`);
    console.log(`📂 Base Path: ${WORKSHOP_BASE_PATH}`);
    console.log('===================================================');
});