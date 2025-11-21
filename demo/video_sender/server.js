const http = require("http");
const fs = require("fs");
const path = require("path");

// =====================================================================
// 🛠️ 关键配置：硬编码您要测试的 WEBM 文件路径和端口
// =====================================================================
const PORT = 40003;
const FILE_PATH =
  "C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\431960\\1747779570\\files\\wallpaper.webm";
const FILE_MIME = "video/webm";
// =====================================================================

const server = http.createServer((req, res) => {
  // 允许跨域和 Range 请求头
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Accept-Ranges", "bytes");

  if (req.url !== "/get") {
    res.writeHead(404);
    res.end("Use /get endpoint.");
    return;
  }

  fs.stat(FILE_PATH, (err, stats) => {
    if (err) {
      console.error(`❌ File access failed: ${err.code}`);
      res.writeHead(404);
      res.end("File not found or inaccessible on disk.");
      return;
    }

    const fileSize = stats.size;
    const range = req.headers.range;

    // --- Range Request (HTTP 206) 处理 ---
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": FILE_MIME,
      });

      // 使用流式传输
      fs.createReadStream(FILE_PATH, { start, end }).pipe(res);
    }
    // --- 完整请求 (HTTP 200) 处理 ---
    else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": FILE_MIME,
      });
      fs.createReadStream(FILE_PATH).pipe(res);
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("=====================================================");
  console.log(
    `✅ Server running. Target URL for video: http://127.0.0.1:${PORT}/get`
  );
  console.log(`Serving file: ${FILE_PATH}`);
  console.log("=====================================================");
});
