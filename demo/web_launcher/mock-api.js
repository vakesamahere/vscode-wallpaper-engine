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
        console.log(`[WE-Mock] ⚠️ Wallpaper tried to require('${moduleName}')`);
        
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
    window.module = { exports: {} };
    window.exports = window.module.exports;

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