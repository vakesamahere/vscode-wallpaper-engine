import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WebSocket, WebSocketServer } from 'ws';
import { WALLPAPER_SERVER_PORT } from '../config/constants';
import { MOCK_API_SCRIPT, BOOTSTRAP_SCRIPT } from './web-api-mock';

export class WallpaperServer {
    private server: http.Server | null = null;
    private wss: WebSocketServer | null = null;
    private currentRoot: string = '';
    private retryInterval: NodeJS.Timeout | null = null;
    // 端口必须与 injector.ts 里的保持一致
    private PORT = WALLPAPER_SERVER_PORT; 

    private searchPaths: string[] = [];
    private workshopBasePath: string | null = null;
    private reloadFlag = false; // [New] Flag to trigger client reload

    private shutdownTimeout: NodeJS.Timeout | null = null;
    private readonly SHUTDOWN_DELAY = 2 * 60 * 1000; // 2 minutes

    constructor(private context: vscode.ExtensionContext) {
        // 插件启动时，尝试恢复之前的服务器状态
        const lastPath = this.context.globalState.get<string>('currentWallpaperPath');
        if (lastPath && fs.existsSync(lastPath)) {
            console.log(`[Server] Restoring server for: ${lastPath}`);
            // 获取配置的端口
            const config = vscode.workspace.getConfiguration('vscode-wallpaper-engine');
            const port = config.get<number>('serverPort') || WALLPAPER_SERVER_PORT;
            // this.start(lastPath, port, true); // true 表示这是静默启动，不弹窗
        }
    }

    private resetShutdownTimer() {
        if (this.shutdownTimeout) {
            clearTimeout(this.shutdownTimeout);
        }
        this.shutdownTimeout = setTimeout(() => {
            console.log('[Server] Auto-shutdown due to inactivity.');
            this.stop();
        }, this.SHUTDOWN_DELAY);
    }

    public triggerReload() {
        this.reloadFlag = true;
    }

    private checkServerStatus(port: number): Promise<{ running: boolean, rootPath: string } | null> {
        return new Promise((resolve) => {
            const req = http.get(`http://127.0.0.1:${port}/status`, (res) => {
                if (res.statusCode !== 200) {
                    resolve(null);
                    return;
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve(null);
                    }
                });
            });
            req.on('error', () => resolve(null));
            req.setTimeout(500, () => {
                req.destroy();
                resolve(null);
            });
        });
    }

    private shutdownRemoteServer(port: number): Promise<void> {
        return new Promise((resolve) => {
            const req = http.get(`http://127.0.0.1:${port}/shutdown`, (res) => {
                resolve();
            });
            req.on('error', () => resolve());
            req.setTimeout(1000, () => {
                req.destroy();
                resolve();
            });
        });
    }

    // [修改] 变成 async，确保状态保存完毕
    public async start(rootPath: string, port: number, silent = false) {
        this.PORT = port;
        vscode.window.setStatusBarMessage(`Preparing Wallpaper Server...`, 5000);
        
        // 1. Check local instance
        if (this.server && this.currentRoot === rootPath) {
            return;
        }

        // 2. Check external instance (Multi-window support)
        const status = await this.checkServerStatus(port);
        if (status && status.running) {
            if (status.rootPath === rootPath) {
                console.log(`[Server] Reusing existing server for ${rootPath}`);
                this.currentRoot = rootPath;
                // Even if we reuse, we should ensure global state is synced
                await this.context.globalState.update('currentWallpaperPath', rootPath);
                return;
            } else {
                console.log(`[Server] Existing server running different path (${status.rootPath}). Restarting...`);
                await this.shutdownRemoteServer(port);
                // Wait for port to be released
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // 关闭旧服务
        this.stop();

        this.currentRoot = rootPath;
        
        // [关键] 等待状态保存完成！防止重启后丢失路径
        await this.context.globalState.update('currentWallpaperPath', rootPath);

        this.updateSearchPaths(rootPath); // [New] Update search paths on server start
        
        this.resetShutdownTimer(); // Start the timer

        console.log(`[Server] Starting server at port ${this.PORT} for root: ${this.currentRoot}`);
        this.server = http.createServer((req, res) => {
            this.resetShutdownTimer(); // Reset timer on every request

            const safeRoot = path.normalize(this.currentRoot);
            // 简单的 URL 处理
            let reqUrl = req.url ? decodeURIComponent(req.url.split('?')[0]) : '/';
            
            console.log(`[Server] Request: ${req.method} ${req.url} -> ${reqUrl}`);

            // 默认访问 index.html
            if (reqUrl === '/' || reqUrl === '') {
                reqUrl = '/index.html';
            }

            // [Removed] filePath calculation moved to end
            // const filePath = path.join(safeRoot, reqUrl);
            // if (!filePath.startsWith(safeRoot)) { ... }

            // ping，用于检测服务器是否在线，直接返回 200
            if (reqUrl === '/ping') {
                res.setHeader('Access-Control-Allow-Origin', '*');
                if (this.reloadFlag) {
                    this.reloadFlag = false;
                    res.statusCode = 205; // Reset Content
                    res.end('reload');
                } else {
                    res.statusCode = 200;
                    res.end('pong');
                }
                return;
            }

            // [New] Status endpoint for multi-instance check
            if (reqUrl === '/status') {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({
                    running: true,
                    rootPath: this.currentRoot
                }));
                return;
            }

            // [New] Shutdown endpoint for multi-instance takeover
            if (reqUrl === '/shutdown') {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end('ok');
                setTimeout(() => {
                    console.log('[Server] Remote shutdown requested.');
                    this.stop();
                }, 100);
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

            // [New] API to get entry HTML (for srcdoc injection)
            if (reqUrl === '/api/get-entry') {
                let entryPath = '';
                for (const basePath of this.searchPaths) {
                    const tryPath = path.join(basePath, 'index.html');
                    if (fs.existsSync(tryPath)) {
                        entryPath = tryPath;
                        break;
                    }
                }

                if (!entryPath) {
                    res.statusCode = 404;
                    res.end('Entry Not Found');
                    return;
                }

                fs.readFile(entryPath, (err, data) => {
                    if (err) {
                        res.statusCode = 404;
                        res.end('Entry Not Found');
                        return;
                    }
                    let html = data.toString('utf-8');

                    // [Fix] Video playback issue: Convert <video><source src="..."></video> to <video src="..."></video>
                    // Regex explanation:
                    // 1. (<video[^>]*)   : Match opening video tag and attributes
                    // 2. (>[\s\S]*?)     : Match content between video tag and source tag (non-greedy)
                    // 3. <source[^>]*\s+src=['"]([^'"]+)['"][^>]*> : Match source tag and capture src URL
                    // 4. ([\s\S]*?<\/video>) : Match remaining content and closing video tag
                    html = html.replace(/(<video[^>]*)(>[\s\S]*?)<source[^>]*\s+src=['"]([^'"]+)['"][^>]*>([\s\S]*?<\/video>)/gi, '$1 src="$3"$2$4');

                    // Inject base tag and scripts
                    const injection = `
<base href="http://127.0.0.1:${this.PORT}/" />
<style>
    /* Hide common debug elements (stats.js, dat.gui, etc) */
    #stats, .stats, #fps, .fps, #debug, .debug, .dg.ac { display: none !important; }
</style>
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
                    res.setHeader('Content-Type', 'text/html');
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.end(html);
                });
                return;
            }

            // [New] API: readdir
            if (reqUrl === '/api/readdir') {
                const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
                let targetPath = urlObj.searchParams.get("path");
                if (targetPath) {
                    targetPath = targetPath.replace(/^[\\/]+/, ""); // Remove leading slashes
                    
                    // Search in all paths
                    let allFiles = new Set<string>();
                    for (const basePath of this.searchPaths) {
                        const fullPath = path.join(basePath, targetPath);
                        if (fullPath.startsWith(basePath) && fs.existsSync(fullPath)) {
                            try {
                                if (fs.statSync(fullPath).isDirectory()) {
                                    const files = fs.readdirSync(fullPath);
                                    files.forEach(f => allFiles.add(f));
                                }
                            } catch (e) {}
                        }
                    }
                    
                    if (allFiles.size > 0) {
                        res.setHeader('Content-Type', 'application/json');
                        res.setHeader('Access-Control-Allow-Origin', '*');
                        res.end(JSON.stringify(Array.from(allFiles)));
                        return;
                    }
                }
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end('[]');
                return;
            }

            // [New] API: random-file
            if (reqUrl === '/api/random-file') {
                console.log(`[Server] Handling random-file request`);
                const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
                const propName = urlObj.searchParams.get("prop");
                
                // 1. Read project.json (merged)
                let finalProps: any = {};
                for (let i = this.searchPaths.length - 1; i >= 0; i--) {
                    const pPath = path.join(this.searchPaths[i], "project.json");
                    if (fs.existsSync(pPath)) {
                        try {
                            const content = JSON.parse(fs.readFileSync(pPath, "utf-8"));
                            const props = content.properties || (content.general && content.general.properties) || {};
                            Object.assign(finalProps, props);
                            if (content.preset) {
                                Object.keys(content.preset).forEach((key: string) => {
                                    if (finalProps[key]) {
                                        finalProps[key].value = content.preset[key];
                                    }
                                });
                            }
                        } catch (e) {}
                    }
                }

                let targetPath: string | null = null;
                let prop = finalProps[propName || ''];
                if (!prop && propName) {
                    const key = Object.keys(finalProps).find(k => k.toLowerCase() === propName.toLowerCase());
                    if (key) { prop = finalProps[key]; }
                }
                
                if (prop) {
                    targetPath = prop.value || prop.default;
                }

                let fileUrl = null;
                if (targetPath) {
                    targetPath = targetPath.replace(/^[\\/]+/, "");
                    
                    // Find files in all search paths
                    let allFiles: string[] = [];
                    for (const basePath of this.searchPaths) {
                        const fullPath = path.join(basePath, targetPath);
                        if (fullPath.startsWith(basePath) && fs.existsSync(fullPath)) {
                            try {
                                if (fs.statSync(fullPath).isDirectory()) {
                                    const files = fs.readdirSync(fullPath);
                                    const validFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webm|mp4)$/i.test(f));
                                    allFiles = allFiles.concat(validFiles);
                                }
                            } catch (e) {}
                        }
                    }

                    if (allFiles.length > 0) {
                        const randomFile = allFiles[Math.floor(Math.random() * allFiles.length)];
                        fileUrl = `http://127.0.0.1:${this.PORT}/${targetPath}/${randomFile}`;
                    }
                }
                
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify({ file: fileUrl }));
                return;
            }

            // [New] API: Proxy
            if (reqUrl === '/proxy') {
                const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
                const targetUrl = urlObj.searchParams.get("url");
                if (!targetUrl) {
                    res.statusCode = 400;
                    res.end("Missing url param");
                    return;
                }

                console.log(`[Proxy] ${targetUrl}`);
                const lib = targetUrl.startsWith("https") ? https : http;
                const proxyReq = lib.get(targetUrl, (proxyRes) => {
                    // Copy headers but ensure CORS
                    const headers = { ...proxyRes.headers };
                    // Remove existing CORS headers to avoid conflicts
                    delete headers['access-control-allow-origin'];
                    delete headers['access-control-allow-methods'];
                    delete headers['access-control-allow-headers'];
                    
                    headers["access-control-allow-origin"] = "*";
                    headers["access-control-allow-methods"] = "GET, POST, OPTIONS";
                    headers["access-control-allow-headers"] = "*";
                    headers["access-control-allow-credentials"] = "true";
                    
                    res.writeHead(proxyRes.statusCode || 200, headers);
                    proxyRes.pipe(res);
                });
                
                proxyReq.on("error", (e) => {
                    console.error(`[Proxy Error] ${e.message}`);
                    res.statusCode = 500;
                    res.end(e.message);
                });
                return;
            }

            // [New] API: Serve processed project.json (with presets applied)
            if (reqUrl === '/project.json') {
                let finalProject: any = {};
                let finalProps: any = {};
                
                // Merge from dependencies (reverse order)
                for (let i = this.searchPaths.length - 1; i >= 0; i--) {
                    const pPath = path.join(this.searchPaths[i], "project.json");
                    if (fs.existsSync(pPath)) {
                        try {
                            console.log(`[add set] Parsing project.json at ${pPath}`);
                            const content = JSON.parse(fs.readFileSync(pPath, "utf-8"));
                            console.log(`[add set] Merging content from ${pPath}`);
                            Object.assign(finalProject, content);
                            
                            const props = content.properties || (content.general && content.general.properties) || {};
                            console.log(`[add set] Found properties: ${Object.keys(props).map(k => `${k}=${props[k].value ?? props[k].default}`).join(', ')}`);
                            Object.assign(finalProps, props);
                            
                            if (content.preset) {
                                console.log(`[add set] Found presets: ${Object.keys(content.preset).join(', ')}`);
                                Object.keys(content.preset).forEach((key: string) => {
                                    if (finalProps[key]) {
                                        console.log(`[add set] Applying preset for ${key}: ${content.preset[key]}`);
                                        finalProps[key].value = content.preset[key];
                                        finalProps[key].default = content.preset[key];
                                    }
                                });
                            }
                        } catch (e) {
                            console.log(`[add set] Error parsing ${pPath}: ${e}`);
                        }
                    }
                }
                
                if (!finalProject.general) { finalProject.general = {}; }
                finalProject.general.properties = finalProps;
                
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.end(JSON.stringify(finalProject));
                return;
            }

            // [Modified] File Serving with Search Paths
            let filePath = '';
            let fileFound = false;
            
            console.log(`[add file] Request: ${reqUrl}`);
            
            for (const basePath of this.searchPaths) {
                const tryPath = path.join(basePath, reqUrl);
                if (tryPath.startsWith(basePath) && fs.existsSync(tryPath) && fs.statSync(tryPath).isFile()) {
                    filePath = tryPath;
                    fileFound = true;
                    console.log(`[add file] Serving: ${filePath}`);
                    break;
                }
            }

            // [New] Fallback: Try to find file in the workshop base path (sibling directories)
            if (!fileFound && this.workshopBasePath) {
                // Remove leading slash for safe joining
                const safeUrl = reqUrl.replace(/^[\\/]+/, "");
                const tryPath = path.join(this.workshopBasePath, safeUrl);
                // Ensure the path is still within workshopBasePath (basic security)
                if (tryPath.startsWith(this.workshopBasePath) && fs.existsSync(tryPath) && fs.statSync(tryPath).isFile()) {
                    filePath = tryPath;
                    fileFound = true;
                    console.log(`[add file] Serving from workshop base: ${filePath}`);
                }
            }

            if (fileFound) {
                fs.readFile(filePath, (err, data) => {
                    if (err) {
                        res.statusCode = 500;
                        res.end('Error reading file');
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
                    } 
                    // [New] Patch JS files to fix file:/// issue (copied from demo)
                    else if (ext === '.js') {
                        let content = data.toString('utf-8');
                        if (content.includes('var path = "file:///" + filePath;')) {
                            console.log(`[Server] Patching file:/// issue in ${path.basename(filePath)}`);
                            content = content.replace(
                                'var path = "file:///" + filePath;',
                                'var path = (filePath.indexOf("http")===0 ? "" : "file:///") + filePath;'
                            );
                            res.end(content);
                        } else {
                            res.end(data);
                        }
                    }
                    else {
                        res.end(data);
                    }
                });
                return;
            } else {
                console.warn(`[Server 404] ${reqUrl}`);
                console.log(`[add file] Not Found: ${reqUrl} in paths: ${JSON.stringify(this.searchPaths)}`);
                res.statusCode = 404;
                res.end('Not Found');
            }

            // Handle CORS preflight requests
            if (req.method === 'OPTIONS') {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', '*');
                res.writeHead(200);
                res.end();
                return;
            }
        });

        // Initialize WebSocket Server
        try {
            console.log(`[Server] Initializing WebSocket Server`);
            this.wss = new WebSocketServer({ noServer: true });
            
            this.server.on('upgrade', (request, socket, head) => {
                this.wss?.handleUpgrade(request, socket, head, (ws) => {
                    this.wss?.emit('connection', ws, request);
                });
            });

            this.wss.on('connection', (ws) => {
                console.log('[Server] WebSocket connected');
                ws.on('message', (message) => {
                    // Optional: Handle messages from clients
                });
            });
        } catch (e) {
            console.error('[Server] Failed to initialize WebSocket Server:', e);
            vscode.window.showErrorMessage('Failed to start WebSocket Server. Real-time settings will not work.');
        }
        
        console.log(`[Server] Setting up server listeners`);
        vscode.window.setStatusBarMessage(`Wallpaper Server: Running at port ${this.PORT}!`, 5000);
        // 启动监听
        this.server.listen(this.PORT, '127.0.0.1', () => {
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

        // 发一个 /ping 请求，确认服务器已启动
        console.log(`[Server] Sending /ping request to confirm server startup`);
        const req = http.get(`http://127.0.0.1:${this.PORT}/ping`, (res) => {
            // log pong
            vscode.window.setStatusBarMessage(`Wallpaper Server: Success ${res.statusCode}`, 5000);
            console.log(`[Server] Received /ping response with status: ${res.statusCode}`);
            res.resume();
        });
        req.on('error', (e) => {
            vscode.window.setStatusBarMessage(`Wallpaper Server: Error starting server`, 5000);
            console.log(`[Server] /ping request error: ${e.message}`);
        });
    }

    private updateSearchPaths(rootPath: string) {
        console.log(`[add file] Updating search paths for root: ${rootPath}`);
        this.searchPaths = [rootPath];
        
        // Always set workshop base path to parent directory, consistent with demo
        const basePath = path.dirname(rootPath);
        this.workshopBasePath = basePath;
        console.log(`[add file] Inferred base path: ${basePath}`);

        // Try to find dependencies if it looks like a workshop ID
        const match = rootPath.match(/[\\/](\d+)$/);
        if (match) {
            const currentId = match[1];
            
            const visited = new Set([currentId]);
            const queue = [currentId];
            
            while (queue.length > 0) {
                const currId = queue.shift();
                if (!currId) { continue; }

                let currPath = rootPath;
                if (currId !== currentId) {
                    currPath = path.join(basePath, currId);
                }
                
                console.log(`[add file] Checking dependency: ${currId} at ${currPath}`);
                const projPath = path.join(currPath, "project.json");
                if (fs.existsSync(projPath)) {
                    try {
                        const proj = JSON.parse(fs.readFileSync(projPath, "utf-8"));
                        let deps: string[] = [];
                        if (typeof proj.dependency === "string") {
                            deps = [proj.dependency];
                        } else if (Array.isArray(proj.dependency)) {
                            deps = proj.dependency;
                        }
                        
                        if (deps.length > 0) {
                            console.log(`[add file] Found dependencies in ${currId}: ${deps.join(', ')}`);
                        }
                        
                        for (const depId of deps) {
                            if (!visited.has(depId)) {
                                visited.add(depId);
                                queue.push(depId);
                                const depPath = path.join(basePath, depId);
                                if (fs.existsSync(depPath)) {
                                    this.searchPaths.push(depPath);
                                    console.log(`[Server] Added dependency: ${depId}`);
                                    console.log(`[add file] Found dependency path: ${depPath}`);
                                } else {
                                    console.log(`[add file] Dependency path not found: ${depPath}`);
                                }
                            }
                        }
                    } catch (e) {
                        console.log(`[add file] Error reading project.json at ${projPath}: ${e}`);
                    }
                } else {
                    console.log(`[add file] project.json not found at ${projPath}`);
                }
            }
        }
        console.log(`[add file] Final searchPaths: ${JSON.stringify(this.searchPaths)}`);
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
        if (this.shutdownTimeout) {
            clearTimeout(this.shutdownTimeout);
            this.shutdownTimeout = null;
        }
        if (this.wss) {
            this.wss.close();
            this.wss = null;
        }
        if (this.retryInterval) {
            clearInterval(this.retryInterval);
            this.retryInterval = null;
        }
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        console.log('[Server] Server stopped.');
    }

    public broadcast(data: any) {
        if (this.wss) {
            const msg = JSON.stringify(data);
            this.wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(msg);
                }
            });
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