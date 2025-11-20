import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WALLPAPER_SERVER_PORT } from '../config/constants';
import { MOCK_API_SCRIPT, BOOTSTRAP_SCRIPT } from './web-api-mock';

export class WallpaperServer {
    private server: http.Server | null = null;
    private currentRoot: string = '';
    private retryInterval: NodeJS.Timeout | null = null;
    // 端口必须与 injector.ts 里的保持一致
    private PORT = WALLPAPER_SERVER_PORT; 

    constructor(private context: vscode.ExtensionContext) {
        // 插件启动时，尝试恢复之前的服务器状态
        const lastPath = this.context.globalState.get<string>('currentWallpaperPath');
        if (lastPath && fs.existsSync(lastPath)) {
            console.log(`[Server] Restoring server for: ${lastPath}`);
            // 获取配置的端口
            const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
            const port = config.get<number>('serverPort') || WALLPAPER_SERVER_PORT;
            this.start(lastPath, port, true); // true 表示这是静默启动，不弹窗
        }
    }

    // [修改] 变成 async，确保状态保存完毕
    public async start(rootPath: string, port: number, silent = false) {
        this.PORT = port;
        vscode.window.setStatusBarMessage(`Preparing Wallpaper Server...`, 5000);
        // 如果路径没变且服务器开着，跳过
        if (this.server && this.currentRoot === rootPath) {
            // return;
        }

        // 关闭旧服务
        this.stop();

        this.currentRoot = rootPath;
        
        // [关键] 等待状态保存完成！防止重启后丢失路径
        await this.context.globalState.update('currentWallpaperPath', rootPath);

        this.server = http.createServer((req, res) => {
            const safeRoot = path.normalize(this.currentRoot);
            // 简单的 URL 处理
            let reqUrl = req.url ? decodeURIComponent(req.url.split('?')[0]) : '/';
            
            // 默认访问 index.html
            if (reqUrl === '/' || reqUrl === '') {
                reqUrl = '/index.html';
            }

            const filePath = path.join(safeRoot, reqUrl);

            // 安全检查：禁止访问上级目录
            if (!filePath.startsWith(safeRoot)) {
                res.statusCode = 403;
                res.end('Access Denied');
                return;
            }

            // ping，用于检测服务器是否在线，直接返回 200
            if (reqUrl === '/ping') {
                res.statusCode = 200;
                res.end('pong');
                return;
            }

            // [New] Serve Mock API
            if (reqUrl === '/vscode-wallpaper-engine-mock-api.js') {
                res.setHeader('Content-Type', 'application/javascript');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Private-Network', 'true');
                res.end(MOCK_API_SCRIPT);
                return;
            }
            if (reqUrl === '/vscode-wallpaper-engine-bootstrap.js') {
                res.setHeader('Content-Type', 'application/javascript');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Private-Network', 'true');
                res.end(BOOTSTRAP_SCRIPT);
                return;
            }

            fs.readFile(filePath, (err, data) => {
                if (err) {
                    console.warn(`[Server 404] ${reqUrl}`);
                    res.statusCode = 404;
                    res.end('Not Found');
                    return;
                }

                const ext = path.extname(filePath).toLowerCase();
                const mimeType = this.getMimeType(ext);
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Access-Control-Allow-Origin', '*'); // 允许跨域
                res.setHeader('Access-Control-Allow-Private-Network', 'true');

                // [New] Inject scripts into HTML
                if (ext === '.html') {
                    let html = data.toString('utf-8');
                    const injection = `
<script src="/vscode-wallpaper-engine-mock-api.js"></script>
<script src="/vscode-wallpaper-engine-bootstrap.js"></script>
`;
                    if (html.includes('<head>')) {
                        html = html.replace('<head>', '<head>' + injection);
                    } else if (html.includes('<body>')) {
                        html = html.replace('<body>', '<body>' + injection);
                    } else {
                        html = injection + html;
                    }
                    res.end(html);
                } else {
                    res.end(data);
                }
            });
        });

        // 启动监听
        this.server.listen(this.PORT, '0.0.0.0', () => {
            console.log(`Wallpaper Server started on port ${this.PORT}`);
            if (!silent) {
                // 开发阶段提示一下，确保你知道它起来了
                vscode.window.setStatusBarMessage(`Wallpaper Server: Running at port ${this.PORT}`, 5000);
            }
        });

        this.server.on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                console.log(`Port ${this.PORT} is busy. Switching to standby mode.`);
                this.startWatchdog();
            } else {
                vscode.window.showErrorMessage(`壁纸服务器启动失败: ${err.message}`);
            }
        });
    }

    private startWatchdog() {
        if (this.retryInterval) { clearInterval(this.retryInterval); }
        console.log('[Server] Watchdog started. Waiting for port to be free...');
        
        this.retryInterval = setInterval(() => {
            // 尝试连接端口，看是否有人在监听
            const req = http.get(`http://127.0.0.1:${this.PORT}/ping`, (res) => {
                // 连接成功，说明主服务器还活着，什么都不做
                res.resume();
            });

            req.on('error', (e) => {
                // 连接失败，说明主服务器可能挂了
                console.log('[Server] Primary server unreachable. Attempting to take over...');
                // 停止 watchdog，尝试启动服务器
                if (this.retryInterval) { clearInterval(this.retryInterval); }
                this.retryInterval = null;
                this.start(this.currentRoot, this.PORT, true);
            });
            
            // 设置超时，防止请求挂起
            req.setTimeout(2000, () => {
                req.destroy();
            });

        }, 5000); // 每 5 秒检查一次
    }

    public stop() {
        if (this.retryInterval) {
            clearInterval(this.retryInterval);
            this.retryInterval = null;
        }
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }

    private getMimeType(ext: string): string {
        const map: { [key: string]: string } = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.gif': 'image/gif',
            '.svg': 'image/svg+xml',
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg',
            '.mp4': 'video/mp4',
            '.webm': 'video/webm',
            '.wasm': 'application/wasm',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.ttf': 'font/ttf',
            '.frag': 'text/plain',
            '.vert': 'text/plain',
            '.glsl': 'text/plain',
        };
        return map[ext] || 'application/octet-stream';
    }
}