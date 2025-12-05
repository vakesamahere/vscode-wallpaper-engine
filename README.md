# VS Code Wallpaper Engine

[![Version](https://img.shields.io/visual-studio-marketplace/v/vakesamahere.vscode-wallpaper-engine)](https://marketplace.visualstudio.com/items?itemName=vakesamahere.vscode-wallpaper-engine)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/vakesamahere.vscode-wallpaper-engine)](https://marketplace.visualstudio.com/items?itemName=vakesamahere.vscode-wallpaper-engine)

将 **Wallpaper Engine** 的动态壁纸带入 VS Code！让你的代码编辑器背景动起来。

本插件通过在 VS Code 核心文件中注入代码，实现了真正的动态背景支持，并提供了强大的 UI 透明化控制功能，让你在享受动态壁纸的同时，依然保持高效的编码体验。

## ✨ 主要功能

- **Wallpaper Engine 支持**: 直接加载 Steam 创意工坊中的 Web 类型壁纸。
- **深度透明化**: 不仅仅是简单的透明度，支持对编辑器、侧边栏、面板、终端等 UI 元素进行**精细化的透明度控制**。
- **智能配色**: 自动适配当前主题颜色，支持自定义透明基底颜色，确保在任何主题下都能获得完美的视觉效果。
- **自定义增强**: 支持注入自定义 CSS 和 JavaScript，随心所欲定制你的编辑器外观。
- **热重载**: 修改配置或切换壁纸后，无需重启即可预览部分效果（完整注入需重启）。

## 🚀 快速开始

### 前置要求

1.  已安装 **Wallpaper Engine** (Steam 版本)。
2.  **权限说明**: 首次安装或更新注入时，插件会请求管理员权限 (Sudo) 以修改 VS Code 核心文件，请允许。

### 安装步骤

1.  在 VS Code 插件市场搜索并安装 `vscode-wallpaper-engine`。
2.  **配置壁纸路径**:
    - 打开 VS Code 设置 (`Ctrl+,`)。
    - 搜索 `vscode-wallpaper-engine.workshopPath`。
    - 填入你的 Wallpaper Engine 创意工坊目录路径。
    - _通常路径示例_: `D:/Steam/steamapps/workshop/content/431960`
3.  **设置壁纸**:
    - 按 `F1` 或 `Ctrl+Shift+P` 打开命令面板。
    - 输入并执行 `Set Wallpaper: 设置壁纸`。
    - 从列表中选择一个壁纸。
4.  **重启 VS Code**:
    - 插件会提示重启以应用核心注入补丁。
    - **注意**: 初次设置壁纸或更新注入后，必须重启 VS Code 或执行 `Developer: Reload Window` (Ctrl+Shift+P -> Reload Window) 才能生效。

## ⚙️ 配置详解

### 核心设置

- `vscode-wallpaper-engine.workshopPath`: Wallpaper Engine 创意工坊文件夹路径 (ID: 431960)。
- `vscode-wallpaper-engine.serverPort`: 本地壁纸服务器端口 (默认 23333)。

### 透明化设置 (Transparency)

本插件使用 `workbench.colorCustomizations` API 来实现非侵入式的 UI 透明化。

- **Enable Transparency**: 全局开启/关闭透明化效果。
- **Transparency Rules**: 精细控制各个 UI 区域的透明度 (0 = 完全透明, 1 = 不透明)。
  - `editor.background`: 代码编辑区
  - `sideBar.background`: 侧边栏
  - `panel.background`: 底部面板 (终端/输出)
  - `terminal.background`: 终端背景
  - ...更多
- **Base Color**: 透明化的基底颜色。
  - _Auto_: 留空则自动根据当前主题 (深色/浅色) 选择黑色或白色。
  - _Custom_: 输入 Hex 颜色 (如 `#1e1e1e`) 来强制指定基底颜色，解决部分主题下透明后颜色发黑或发白的问题。

### 高级设置

- `vscode-wallpaper-engine.customCss`: 注入自定义 CSS 代码，用于微调界面样式。
- `vscode-wallpaper-engine.customJs`: 注入自定义 JS 代码。

## 🎮 使用指南

### 打开设置面板

执行命令 `Open Wallpaper Settings: 打开壁纸设置`，你可以：

- 查看服务器状态。
- 一键切换壁纸。
- **可视化调节透明度**: 提供滑块和开关，实时预览配置变更。
- 编辑自定义 CSS。

### 卸载插件

**⚠️ 重要**: 本插件通过注入 JS/HTML 代码并修改 CSP (内容安全策略) 到 VS Code 核心文件中来实现功能。直接移除插件**不会**自动撤销这些修改。

**请务必按照以下步骤卸载：**

1.  执行命令 `Uninstall Wallpaper Engine: 卸载插件`。
2.  等待提示清理完成 (Clean up success)。
3.  在插件管理页面禁用或卸载本插件。
4.  重启 VS Code。

## ❓ 常见问题 (Troubleshooting)

### 视频壁纸无法播放 / 黑屏？

VS Code 内置的 Electron 环境默认携带的 `ffmpeg.dll` 是精简版，不支持 WebM 等常见视频格式。

**解决方法**:

1.  检查你的 VS Code 版本对应的 Electron 版本 (Help -> About -> Electron)。
2.  下载对应 Electron 版本的完整版 `ffmpeg.dll`。
3.  替换 VS Code 安装目录下的 `ffmpeg.dll` 文件。

## ⚠️ 免责声明

本插件通过修改 VS Code 安装目录下的核心文件 (`workbench.html` 等) 来实现功能。虽然我们尽力确保稳定性，但：

- VS Code 更新后，注入的代码可能会被覆盖，需要重新运行设置壁纸命令。
- 如果 VS Code 提示 "Installation appears to be corrupt" (安装似乎已损坏)，这是正常现象，点击 "不再提示" 即可，或者点击齿轮图标选择 "Don't show again"。
- 请自行承担使用风险。

## 📝 更新日志

请查看 [CHANGELOG.md](CHANGELOG.md) 获取最新更新信息。

---

**Enjoy your coding with live wallpapers!** 🎨

## ☕️ Buy Me A Coffee (支持作者)

<img src="assets/wechat_pay.jpg" width="200" alt="wechat_pay">
