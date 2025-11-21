
export const MOCK_API_SCRIPT = `
(function() {
    console.log("[WE-Mock] Initializing Environment...");

    // ============================================================
    // 🛠️ Node.js / Electron 环境伪造 (Polyfill)
    // 解决 Uncaught ReferenceError: require is not defined
    // ============================================================
    
    // 1. 模拟 require
    // 很多壁纸用它来加载 vue, three.js 或者 json
    // 我们返回一个 Proxy 或者空对象，防止报错
    window.require = function(moduleName) {
        console.log(\`[WE-Mock] ⚠️ Wallpaper tried to require('\${moduleName}')\`);
        
        // 针对常见模块做特殊 Mock
        if (moduleName === 'fs') {
            return {
                readFileSync: () => '',
                readFile: (path, cb) => cb(null, ''),
                existsSync: () => false
            };
        }
        if (moduleName === 'path') {
            return {
                join: (...args) => args.join('/'),
                resolve: (...args) => args.join('/')
            };
        }
        if (moduleName === 'electron') {
            return {
                ipcRenderer: {
                    on: () => {},
                    send: () => {},
                    removeListener: () => {}
                }
            };
        }
        
        // 默认返回空对象，防止调用报错
        return {};
    };

    // 2. 模拟 module 和 exports (CommonJS 规范)
    // [FIX] Three.js 等库如果检测到 module/exports 会尝试导出而不是挂载到 window
    // 所以这里必须显式设为 undefined，强制它们使用 Global 模式
    window.module = undefined;
    window.exports = undefined;
    window.define = undefined;

    // 3. 模拟 process (用于检测环境变量)
    window.process = {
        type: 'renderer',
        versions: { electron: 'mock', chrome: 'mock', node: 'mock' },
        platform: 'win32',
        env: { NODE_ENV: 'development' }
    };

    // 4. 模拟 global
    window.global = window;

    // ============================================================
    // 🎨 Wallpaper Engine API 模拟
    // ============================================================

    window.__WE_CALLBACKS__ = {
        properties: null,
        audio: null,
        general: null
    };

    // 核心 API
    Object.defineProperty(window, 'wallpaperPropertyListener', {
        set: function(l) {
            console.log("[WE-Mock] Property Listener Registered");
            window.__WE_CALLBACKS__.properties = l;
            window.__WE_CALLBACKS__.general = l;
        },
        get: function() { return window.__WE_CALLBACKS__.properties; }
    });

    window.wallpaperRegisterAudioListener = function(cb) {
        console.log("[WE-Mock] Audio Listener Registered");
        window.__WE_CALLBACKS__.audio = cb;
    };

    // 辅助 API (防止报错)
    window.wallpaperRegisterMediaStatusListener = function() {};
    window.wallpaperRegisterMediaPropertiesListener = function() {};
    window.wallpaperRegisterMediaTimelineListener = function() {};
    window.wallpaperRequestRandomFileForProperty = function(name, cb) {
        console.log("[WE-Mock] Request File:", name);
        // 模拟返回一个占位图，实际使用中可能需要指向 server 里的某个默认图
        cb('preview.jpg'); 
    };

    // ============================================================
    // 📡 通信处理
    // ============================================================
    window.addEventListener('message', (e) => {
        if (!e.data) return;
        const { type, data } = e.data;
        const cbs = window.__WE_CALLBACKS__;

        if (type === 'UPDATE_PROPERTIES' && cbs.properties) {
            // 防御性编程：有些壁纸没有实现 applyUserProperties
            if (cbs.properties.applyUserProperties) {
                cbs.properties.applyUserProperties(data);
            }
        } 
        else if (type === 'AUDIO_TICK' && cbs.audio) {
            cbs.audio(data);
        }
        else if (type === 'INIT_GENERAL' && cbs.general) {
            if (cbs.general.applyGeneralProperties) {
                cbs.general.applyGeneralProperties({ fps: 60, isActive: true });
            }
        }
    });
    
    console.log("[WE-Mock] Ready.");
})();
`;

export const BOOTSTRAP_SCRIPT = `
(function() {
    console.log("[WE-Boot] Starting...");
    
    // 简单的帮助函数，用于转换 project.json 里的属性格式到 WE API 需要的格式
    function parseProperties(rawProps) {
        const result = {};
        for (const key in rawProps) {
            const prop = rawProps[key];
            let val = prop.value;
            if (val === undefined) val = prop.default;
            
            // Safe defaults
            if (val === undefined) {
                if (prop.type === 'color') val = "1 1 1";
                else if (prop.type === 'slider') val = 0;
                else if (prop.type === 'bool') val = false;
                else if (prop.type === 'text') val = "";
                else if (prop.type === 'combo') val = (prop.options && prop.options.length > 0) ? prop.options[0].value : "";
                else val = ""; // Fallback
            }

            // Wrap in value object as expected by WE
            result[key] = { value: val };
        }
        return result;
    }

    fetch('/project.json')
        .then(res => res.json())
        .then(data => {
            console.log("[WE-Boot] Loaded project.json", data);
            
            // 1. 发送通用设置 (FPS 等)
            window.postMessage({ type: 'INIT_GENERAL' }, '*');

            // 2. 发送属性
            if (data.general && data.general.properties) {
                const props = parseProperties(data.general.properties);
                console.log("[WE-Boot] Sending properties:", props);
                
                // 稍微延迟一下，确保 wallpaperPropertyListener 已经注册
                setTimeout(() => {
                    window.postMessage({ type: 'UPDATE_PROPERTIES', data: props }, '*');
                }, 500);
                
                // 再试一次，以防万一
                setTimeout(() => {
                    window.postMessage({ type: 'UPDATE_PROPERTIES', data: props }, '*');
                }, 2000);
            }
        })
        .catch(e => console.error("[WE-Boot] Failed to load project.json", e));
})();
`;
