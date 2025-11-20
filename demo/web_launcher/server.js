const http = require("http");
const fs = require("fs");
const path = require("path");

// =====================================================================
// 🛠️ 配置区：填入 Wallpaper Engine 创意工坊的基础路径 (不包含具体ID)
// =====================================================================
const WORKSHOP_BASE_PATH = String.raw`C:\Program Files (x86)\Steam\steamapps\workshop\content\431960`;
// =====================================================================

const PORT = 33333;
const DEMO_ROOT = __dirname;

// 默认当前 ID (可以为空，等待前端设置)
let currentId = "";
let searchPaths = [];

const mimeTypes = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

const server = http.createServer((req, res) => {
  // 跨域头
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  let reqUrl = decodeURIComponent(req.url.split("?")[0]);

  // --- API: Proxy ---
  if (reqUrl === "/proxy") {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const targetUrl = urlObj.searchParams.get("url");
    if (!targetUrl) {
      res.writeHead(400);
      res.end("Missing url param");
      return;
    }

    console.log(`[Proxy] ${targetUrl}`);
    const lib = targetUrl.startsWith("https")
      ? require("https")
      : require("http");
    lib
      .get(targetUrl, (proxyRes) => {
        // Copy headers but ensure CORS
        const headers = { ...proxyRes.headers };
        headers["access-control-allow-origin"] = "*";
        res.writeHead(proxyRes.statusCode, headers);
        proxyRes.pipe(res);
      })
      .on("error", (e) => {
        console.error(`[Proxy Error] ${e.message}`);
        res.writeHead(500);
        res.end(e.message);
      });
    return;
  }

  // --- API: 设置当前壁纸 ID ---
  if (reqUrl === "/api/set-id" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", () => {
      try {
        const { id } = JSON.parse(body);
        const newPath = path.join(WORKSHOP_BASE_PATH, id);

        if (fs.existsSync(newPath)) {
          currentId = id;

          // Resolve all dependencies recursively
          const paths = [newPath];
          const visited = new Set([id]);
          const queue = [id];

          while (queue.length > 0) {
            const currId = queue.shift();
            const currPath = path.join(WORKSHOP_BASE_PATH, currId);
            const projPath = path.join(currPath, "project.json");

            if (fs.existsSync(projPath)) {
              try {
                const proj = JSON.parse(fs.readFileSync(projPath, "utf-8"));
                let deps = [];
                if (typeof proj.dependency === "string") {
                  deps = [proj.dependency];
                } else if (Array.isArray(proj.dependency)) {
                  deps = proj.dependency;
                }

                for (const depId of deps) {
                  if (!visited.has(depId)) {
                    visited.add(depId);
                    queue.push(depId);
                    const depPath = path.join(WORKSHOP_BASE_PATH, depId);
                    if (fs.existsSync(depPath)) {
                      paths.push(depPath);
                      console.log(
                        `[Server] Added dependency: ${depId} -> ${depPath}`
                      );
                    }
                  }
                }
              } catch (e) {
                console.error(`Error reading project.json for ${currId}`, e);
              }
            }
          }
          searchPaths = paths;

          console.log(`[Server] Switched to ID: ${id}`);
          console.log(`[Server] Search Paths:`, searchPaths);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              fullPath: newPath,
              searchPaths: searchPaths,
            })
          );
        } else {
          console.error(`[Server] ID not found: ${id}`);
          res.writeHead(400);
          res.end(JSON.stringify({ error: "ID directory does not exist" }));
        }
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // --- API: readdir (for slideshows) ---
  if (reqUrl === "/api/readdir") {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    let targetPath = urlObj.searchParams.get("path");

    // Sanitize path
    if (targetPath) {
      targetPath = targetPath.replace(/^[\\/]+/, "");
    }

    let allFiles = new Set();
    if (targetPath) {
      for (const basePath of searchPaths) {
        const fullPath = path.join(basePath, targetPath);
        console.log(`[Server] readdir check: ${fullPath}`);
        if (fs.existsSync(fullPath)) {
          try {
            if (fs.statSync(fullPath).isDirectory()) {
              const files = fs.readdirSync(fullPath);
              console.log(`  -> Found ${files.length} files in ${basePath}`);
              files.forEach((f) => {
                console.log(`     + ${f}`);
                allFiles.add(f);
              });
            }
          } catch (e) {
            console.error(e);
          }
        }
      }
    }
    const foundFiles = Array.from(allFiles);
    console.log(
      `[Server] readdir: ${targetPath} -> Found ${foundFiles.length} files (merged)`
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(foundFiles));
    return;
  }

  // --- API: random-file (for wallpaperRequestRandomFileForProperty) ---
  if (reqUrl === "/api/random-file") {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    const propName = urlObj.searchParams.get("prop");

    // 1. Resolve merged project.json to find property value
    let finalProps = {};
    for (let i = searchPaths.length - 1; i >= 0; i--) {
      const pPath = path.join(searchPaths[i], "project.json");
      if (fs.existsSync(pPath)) {
        try {
          const content = JSON.parse(fs.readFileSync(pPath, "utf-8"));
          const props =
            content.properties ||
            (content.general && content.general.properties) ||
            {};
          Object.assign(finalProps, props);
          if (content.preset) {
            Object.keys(content.preset).forEach((key) => {
              if (finalProps[key]) {
                finalProps[key].value = content.preset[key];
                finalProps[key].default = content.preset[key];
              }
            });
          }
        } catch (e) {}
      }
    }

    let prop = finalProps[propName];
    // Case-insensitive fallback
    if (!prop) {
      const key = Object.keys(finalProps).find(
        (k) => k.toLowerCase() === propName.toLowerCase()
      );
      if (key) {
        prop = finalProps[key];
        console.log(
          `[Server] random-file: Case-insensitive match '${propName}' -> '${key}'`
        );
      }
    }

    let targetPath = prop ? prop.value || prop.default : null;

    console.log(
      `[Server] random-file: prop='${propName}' -> path='${targetPath}'`
    );

    // Sanitize
    if (targetPath) {
      targetPath = targetPath.replace(/^[\\/]+/, "");
    }
    let foundFile = null;
    if (targetPath) {
      // targetPath is relative, e.g. "directories/background_slideshowfolder"
      let allFiles = [];
      for (const basePath of searchPaths) {
        const fullPath = path.join(basePath, targetPath);
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
          try {
            const files = fs.readdirSync(fullPath);
            const validFiles = files.filter((f) =>
              /\.(jpg|jpeg|png|gif|webm|mp4)$/i.test(f)
            );
            validFiles.forEach((f) =>
              console.log(`     + Candidate: ${f} (${basePath})`)
            );
            allFiles = allFiles.concat(validFiles);
          } catch (e) {}
        }
      }

      if (allFiles.length > 0) {
        const randomFile =
          allFiles[Math.floor(Math.random() * allFiles.length)];
        // Return relative path that can be fetched from server
        foundFile = path.join(targetPath, randomFile).replace(/\\/g, "/");
      }
    }

    // If we found a file, return the full URL (mocking absolute path behavior)
    // But wait, if we return "http://...", and the wallpaper does "file:///" + url, it breaks.
    // If we return "C:/...", the wallpaper does "file:///C:/...", browser blocks it.
    // We must return a path that the wallpaper uses as is, OR we must intercept the usage.
    // If we return "http://127.0.0.1:33333/..." and the wallpaper puts it in img.src, it works.
    // So let's return the full URL.
    const fileUrl = foundFile ? `http://127.0.0.1:${PORT}/${foundFile}` : null;

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ file: fileUrl }));
    return;
  }

  // --- 静态文件路由 ---
  if (reqUrl === "/") {
    reqUrl = "/host.html";
  }

  // 1. Demo 工具文件 (host.html, mock-api.js)
  if (reqUrl === "/host.html" || reqUrl === "/mock-api.js") {
    const filePath = path.join(DEMO_ROOT, reqUrl.replace("/", ""));
    serveFile(res, filePath, "DEMO");
    return;
  }

  // 2. 壁纸文件
  if (!currentId) {
    res.writeHead(404);
    res.end("No wallpaper ID selected. Use UI to set ID.");
    return;
  }

  // --- Special handling for project.json (Merge dependencies) ---
  if (reqUrl === "/project.json") {
    let finalProject = {};
    let finalProps = {};

    // Iterate from dependency -> main (deepest first)
    for (let i = searchPaths.length - 1; i >= 0; i--) {
      const pPath = path.join(searchPaths[i], "project.json");
      if (fs.existsSync(pPath)) {
        try {
          const content = JSON.parse(fs.readFileSync(pPath, "utf-8"));

          // 1. Merge top-level fields (overwriting)
          Object.assign(finalProject, content);

          // 2. Collect properties (merging)
          // Support both root 'properties' and 'general.properties'
          const props =
            content.properties ||
            (content.general && content.general.properties) ||
            {};
          Object.assign(finalProps, props);

          // 3. Apply presets (override values)
          if (content.preset) {
            Object.keys(content.preset).forEach((key) => {
              if (finalProps[key]) {
                // Set the value from preset
                finalProps[key].value = content.preset[key];
                // Also update default to ensure it sticks
                finalProps[key].default = content.preset[key];
              }
            });
          }
        } catch (e) {
          console.error("Error merging project.json", e);
        }
      }
    }

    // Assign merged properties back
    finalProject.properties = finalProps;

    console.log(
      `[Server] Served merged project.json (${
        Object.keys(finalProps).length
      } props)`
    );
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(finalProject));
    return;
  }

  // Try to find file in search paths
  let foundFile = null;
  let foundSource = null;

  for (const basePath of searchPaths) {
    const tryPath = path.join(basePath, reqUrl);
    if (fs.existsSync(tryPath)) {
      foundFile = tryPath;
      foundSource = basePath === searchPaths[0] ? `WP(${currentId})` : `DEP`;
      break;
    }
  }

  if (foundFile) {
    fs.readFile(foundFile, (err, data) => {
      if (!err) {
        serveFile(res, foundFile, foundSource, data);
      } else {
        res.writeHead(500);
        res.end("Read Error");
      }
    });
  } else {
    console.error(`❌ [404] Not found in any path: ${reqUrl}`);
    searchPaths.forEach((p) =>
      console.error(`  - Checked: ${path.join(p, reqUrl)}`)
    );
    res.writeHead(404);
    res.end("Not Found");
  }
});

function serveFile(res, filePath, sourceName, data) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = mimeTypes[ext] || "application/octet-stream";

  if (ext === ".html" || ext === ".json") {
    console.log(`✅ [200] ${path.basename(filePath)} [${sourceName}]`);
  }

  // Patch HTML files to inject mock-api.js
  if (ext === ".html" && sourceName !== "DEMO") {
    if (!data) {
      try {
        data = fs.readFileSync(filePath);
      } catch (e) {
        res.writeHead(500);
        res.end("Read Error");
        return;
      }
    }
    let content = data.toString("utf-8");
    const injection = `
    <!-- WE-Mock Injection -->
    <script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/underscore.js/1.13.6/underscore-min.js"></script>
    <script src="/mock-api.js"></script>
    <!-- End Injection -->
    `;

    if (content.includes("<head>")) {
      content = content.replace("<head>", "<head>" + injection);
    } else if (content.includes("<body>")) {
      content = content.replace("<body>", "<body>" + injection);
    } else {
      content = injection + content;
    }
    data = Buffer.from(content, "utf-8");
  }

  // Patch JS files to fix file:/// issue
  if (ext === ".js") {
    if (!data) {
      try {
        data = fs.readFileSync(filePath);
      } catch (e) {
        res.writeHead(500);
        res.end("Read Error");
        return;
      }
    }

    let content = data.toString("utf-8");
    // Patch: var path = "file:///" + filePath;
    // To: var path = (filePath.indexOf("http")===0 ? "" : "file:///") + filePath;
    if (content.includes('var path = "file:///" + filePath;')) {
      console.log(
        `[Server] Patching file:/// issue in ${path.basename(filePath)}`
      );
      content = content.replace(
        'var path = "file:///" + filePath;',
        'var path = (filePath.indexOf("http")===0 ? "" : "file:///") + filePath;'
      );
      data = Buffer.from(content, "utf-8");
    }
  }

  res.writeHead(200, { "Content-Type": mime });
  if (data) {
    res.end(data);
  } else {
    fs.createReadStream(filePath).pipe(res);
  }
}

server.listen(PORT, () => {
  console.log("===================================================");
  console.log(`🚀 Debugger: http://127.0.0.1:${PORT}/host.html`);
  console.log(`📂 Base Path: ${WORKSHOP_BASE_PATH}`);
  console.log("===================================================");
});
