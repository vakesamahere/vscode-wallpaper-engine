const fs = require("fs");
const path = require("path");

// 定义目标路径，相对于项目根目录
const ARTIFACTS_DIR = path.join(__dirname, "..", "artifacts");
const ROOT_DIR = path.join(__dirname, "..");

// 确保目录存在
if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

// 查找根目录下最新的 VSIX 文件
const vsixFiles = fs
  .readdirSync(ROOT_DIR)
  .filter((file) => file.endsWith(".vsix"))
  .sort((a, b) => {
    // 确保拿到最新的 (简单排序法)
    const aStat = fs.statSync(path.join(ROOT_DIR, a));
    const bStat = fs.statSync(path.join(ROOT_DIR, b));
    return bStat.mtime.getTime() - aStat.mtime.getTime();
  });

if (vsixFiles.length === 0) {
  console.error(
    "❌ Error: No VSIX file found in the root directory after packaging."
  );
  process.exit(1);
}

const vsixFile = vsixFiles[0];
const sourcePath = path.join(ROOT_DIR, vsixFile);
const destPath = path.join(ARTIFACTS_DIR, vsixFile);

// 使用 fs.renameSync (等同于 mv) 移动文件
fs.renameSync(sourcePath, destPath);

console.log(`✅ Moved ${vsixFile} to artifacts/`);
