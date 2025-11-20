(function () {
  console.log("[WE-Mock] Initializing Environment...");

  // ============================================================
  // 🛠️ Node.js / Electron 环境伪造 (Polyfill)
  // 解决 Uncaught ReferenceError: require is not defined
  // ============================================================

  // 1. 模拟 require
  // 很多壁纸用它来加载 vue, three.js 或者 json
  // 我们返回一个 Proxy 或者空对象，防止报错
  window.require = function (moduleName) {
    console.log(`[WE-Mock] ⚠️ Wallpaper tried to require('${moduleName}')`);

    // 针对常见模块做特殊 Mock
    if (moduleName === "jquery") {
      if (window.jQuery) return window.jQuery;
      return window.$ || {};
    }
    if (moduleName === "fs") {
      return {
        readFileSync: () => "",
        readFile: (path, cb) => cb(null, ""),
        existsSync: () => false,
        readdir: (path, cb) => {
          console.log(`[WE-Mock] fs.readdir('${path}')`);
          fetch(
            `http://127.0.0.1:33333/api/readdir?path=${encodeURIComponent(
              path
            )}`
          )
            .then((r) => r.json())
            .then((files) => {
              console.log(`[WE-Mock] fs.readdir result:`, files);
              if (cb) {
                cb(null, files);
              }
            })
            .catch((e) => {
              console.error(`[WE-Mock] fs.readdir error:`, e);
              if (cb) {
                cb(e);
              }
            });
        },
      };
    }
    if (moduleName === "path") {
      return {
        join: (...args) => args.join("/"),
        resolve: (...args) => args.join("/"),
      };
    }
    if (moduleName === "electron") {
      return {
        ipcRenderer: {
          on: () => {},
          send: () => {},
          removeListener: () => {},
        },
      };
    }

    // 默认返回空对象，防止调用报错
    return {};
  };

  // 2. 模拟 module 和 exports (CommonJS 规范)
  window.module = { exports: {} };
  window.exports = window.module.exports;

  // 3. Mock Smooth.js (Arthesian Library dependency)
  if (typeof window.Smooth === "undefined") {
    window.Smooth = function (arr, config) {
      // Return a dummy interpolator function
      // Simple linear interpolation fallback or just return first element
      return function (t) {
        return arr && arr.length > 0 ? arr[0] : 0;
      };
    };
    window.Smooth.METHOD_CUBIC = "cubic";
    window.Smooth.METHOD_LINEAR = "linear";
    window.Smooth.METHOD_NEAREST = "nearest";
    console.log("[WE-Mock] Polyfilled Smooth.js");
  }

  // 4. 模拟 process (Node.js 全局变量)
  window.process = {
    type: "renderer",
    versions: { electron: "mock", chrome: "mock", node: "mock" },
    platform: "win32",
    env: { NODE_ENV: "development" },
  };

  // 5. 模拟 global
  window.global = window;

  // ============================================================
  // 🎨 Wallpaper Engine API 模拟
  // ============================================================

  window.__WE_CALLBACKS__ = {
    properties: null,
    audio: null,
    general: null,
  };

  // 核心 API
  Object.defineProperty(window, "wallpaperPropertyListener", {
    set: function (l) {
      console.log("[WE-Mock] Property Listener Registered");
      window.__WE_CALLBACKS__.properties = l;
      window.__WE_CALLBACKS__.general = l;
    },
    get: function () {
      return window.__WE_CALLBACKS__.properties;
    },
  });

  window.wallpaperRegisterAudioListener = function (cb) {
    console.log("[WE-Mock] Audio Listener Registered");
    window.__WE_CALLBACKS__.audio = cb;
  };

  // 辅助 API (防止报错)
  window.wallpaperRegisterMediaStatusListener = function () {};
  window.wallpaperRegisterMediaPropertiesListener = function () {};
  window.wallpaperRegisterMediaTimelineListener = function () {};
  // window.wallpaperRequestRandomFileForProperty = function (name, cb) {
  //   console.log("[WE-Mock] Request File:", name);
  //   // 模拟返回一个占位图，实际使用中可能需要指向 server 里的某个默认图
  //   cb("preview.jpg");
  // };

  // 5. Mock wallpaperRequestRandomFileForProperty (Slideshows)
  window.wallpaperRequestRandomFileForProperty = function (propName, callback) {
    console.log(
      `[WE-Mock] wallpaperRequestRandomFileForProperty('${propName}')`
    );
    fetch(
      `http://127.0.0.1:33333/api/random-file?prop=${encodeURIComponent(
        propName
      )}`
    )
      .then((r) => r.json())
      .then((data) => {
        console.log(`[WE-Mock] Random file for ${propName}:`, data.file);
        if (data.file) {
          if (callback) {
            callback(propName, data.file);
          }
        } else {
          if (callback) {
            callback(propName, null);
          }
        }
      })
      .catch((e) => {
        console.error(`[WE-Mock] Random file error:`, e);
        if (callback) {
          callback(propName, null);
        }
      });
  };

  // ============================================================
  // 📡 通信处理
  // ============================================================
  window.addEventListener("message", (e) => {
    if (!e.data) return;
    const { type, data } = e.data;
    const cbs = window.__WE_CALLBACKS__;

    if (
      (type === "UPDATE_PROPERTIES" || type === "PROPERTIES") &&
      cbs.properties
    ) {
      // 防御性编程：有些壁纸没有实现 applyUserProperties
      if (cbs.properties.applyUserProperties) {
        cbs.properties.applyUserProperties(data);
      }
    } else if (type === "AUDIO_TICK" && cbs.audio) {
      cbs.audio(data);
    } else if (type === "INIT_GENERAL" && cbs.general) {
      if (cbs.general.applyGeneralProperties) {
        cbs.general.applyGeneralProperties({ fps: 60, isActive: true });
      }
    }
  });

  console.log("[WE-Mock] Ready.");

  // [Fix] Global variables for buggy wallpapers
  window.t = null;
  window.wt = null;

  // [Fix] Intercept Video Play
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    return originalPlay.call(this).catch((e) => {
      if (e.name === "NotAllowedError") {
        console.warn("[WE-Mock] Autoplay blocked, muting and retrying...");
        this.muted = true;
        return originalPlay.call(this);
      }
      throw e;
    });
  };

  // [Fix] Intercept Image Src to prevent "null" requests
  const originalImageSrcDescriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src"
  );
  if (originalImageSrcDescriptor && originalImageSrcDescriptor.set) {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      set: function (val) {
        if (
          val === null ||
          val === "null" ||
          val === undefined ||
          val === "undefined"
        ) {
          console.warn("[WE-Mock] Prevented setting img.src to null/undefined");
          return;
        }
        originalImageSrcDescriptor.set.call(this, val);
      },
      get: originalImageSrcDescriptor.get,
    });
  }

  // [Fix] CORS Proxy Interceptor
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    if (
      typeof url === "string" &&
      url.startsWith("http") &&
      !url.includes(location.host)
    ) {
      console.log(`[WE-Mock] Proxying request: ${url}`);
      url = `/proxy?url=${encodeURIComponent(url)}`;
    }
    return originalOpen.call(this, method, url, ...args);
  };

  // [Fix] Force Autoplay (Keep this as backup)
  function fixVideoAutoplay() {
    const videos = document.getElementsByTagName("video");
    for (let i = 0; i < videos.length; i++) {
      const v = videos[i];
      if (!v.muted) {
        v.muted = true;
        v.setAttribute("muted", "");
      }
      if (!v.autoplay) {
        v.autoplay = true;
        v.setAttribute("autoplay", "");
      }
    }
  }
  setInterval(fixVideoAutoplay, 1000);
})();
