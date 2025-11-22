import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 【透明化目标列表】所有可能遮挡壁纸的 UI 元素 Key
export const TRANSPARENT_COLOR_KEYS = [
    // 核心区域
    "editor.background", // 代码编辑区背景
    "editorGroup.emptyBackground", // 未打开文件时的背景
    "editorGroupHeader.tabsBackground", // 标签页背景
    "terminal.background", // 终端背景

    // 侧边栏/面板
    "sideBar.background", // 侧边栏背景
    "panel.background", // 底部面板背景
    "activityBar.background", // 活动栏 (最左侧图标栏) 背景
    
    // 其他 UI 元素
    "tab.inactiveBackground",
    "tab.activeBackground",
    "tab.unfocusedActiveBackground",
    "statusBar.background" // 状态栏背景 (需注意可读性)
];

/**
 * 自动将 VS Code UI 关键元素的背景色设置为完全透明。
 * @param target 目标配置作用域 (Global 或 Workspace)
 */
export async function applyTransparencyPatch(target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global) {
    const config = vscode.workspace.getConfiguration();
    const enabled = config.get<boolean>('vscode-wallpaper-engine.transparencyEnabled') ?? true;

    if (!enabled) {
        await removeTransparencyPatch(target);
        return;
    }

    const rules = config.get<{[key: string]: number}>('vscode-wallpaper-engine.transparencyRules') || {};

    // 1. 获取现有颜色自定义设置
    const existingCustomizations = config.get<any>('workbench.colorCustomizations') || {};

    // 2. 准备新的配置对象 (复制一份)
    const newCustomizations = { ...existingCustomizations };

    // 获取当前主题类型 (Light/Dark)
    const isLightTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light;
    let defaultBaseColor = isLightTheme ? '#FFFFFF' : '#000000';

    // 检查是否有用户配置的基底颜色
    const configuredBaseColor = config.get<string>('vscode-wallpaper-engine.transparencyBaseColor');
    if (configuredBaseColor && /^#[0-9A-Fa-f]{6}$/.test(configuredBaseColor)) {
        defaultBaseColor = configuredBaseColor;
    }

    // 尝试加载当前激活主题的原始 colors（从主题扩展的 JSON 文件）
    const themeColors = await loadActiveThemeColors();

    // 3. 应用规则
    for (const key of TRANSPARENT_COLOR_KEYS) {
        if (rules[key] !== undefined) {
            // 启用：设置颜色
            // 限制 opacity 在 0-1 之间
            let opacity = rules[key];
            if (opacity < 0) { opacity = 0; }
            if (opacity > 1) { opacity = 1; }
            
            // 计算 Hex Alpha (00-FF)
            const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
            
            // 确定基色 (Base Color)
            let baseColor = defaultBaseColor;

            // 优先级策略：
            // 1. 用户配置的 transparencyBaseColor
            if (configuredBaseColor && /^#[0-9A-Fa-f]{6}$/.test(configuredBaseColor)) {
                baseColor = configuredBaseColor;
            }
            // 2. 尝试使用 user 在 settings.json 中对该 key 的自定义颜色
            else {
                const currentVal = existingCustomizations[key];
                if (typeof currentVal === 'string' && currentVal.startsWith('#')) {
                    // 简单的 Hex 解析
                    if (currentVal.length === 7) { // #RRGGBB
                        baseColor = currentVal;
                    } else if (currentVal.length === 9) { // #RRGGBBAA
                        baseColor = currentVal.substring(0, 7);
                    } else if (currentVal.length === 4) { // #RGB
                        const r = currentVal[1];
                        const g = currentVal[2];
                        const b = currentVal[3];
                        baseColor = `#${r}${r}${g}${g}${b}${b}`;
                    } else if (currentVal.length === 5) { // #RGBA
                        const r = currentVal[1];
                        const g = currentVal[2];
                        const b = currentVal[3];
                        baseColor = `#${r}${r}${g}${g}${b}${b}`;
                    }
                }

                // 3. 尝试从激活主题中获取该 key 的颜色
                if ((!baseColor || baseColor === defaultBaseColor) && themeColors && themeColors[key]) {
                    const tc = normalizeColorString(themeColors[key]);
                    if (tc) {
                        baseColor = tc;
                    }
                }
            }

            newCustomizations[key] = `${baseColor}${alpha}`;
        } else {
            // 禁用：移除配置，恢复默认
            delete newCustomizations[key];
        }
    }

    // 4. 检查是否有变更 (避免重复更新导致闪烁或死循环)
    if (JSON.stringify(existingCustomizations) === JSON.stringify(newCustomizations)) {
        return;
    }

    // 5. 更新设置
    try {
        await config.update('workbench.colorCustomizations', newCustomizations, target);
        vscode.window.setStatusBarMessage('✅ UI Transparency Updated', 2000);
    } catch (error) {
        vscode.window.showErrorMessage('❌ 无法自动修改 settings.json。');
        console.error("Settings update failed:", error);
    }
}

/**
 * 移除我们设置的所有透明度规则。
 */
export async function removeTransparencyPatch(target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global) {
    const config = vscode.workspace.getConfiguration();
    const existingCustomizations: any = config.get('workbench.colorCustomizations') || {};
    
    const cleanedCustomizations = { ...existingCustomizations };

    // 1. 移除我们添加的所有透明度键
    let keysRemoved = false;
    for (const key of TRANSPARENT_COLOR_KEYS) {
        if (cleanedCustomizations[key] !== undefined) {
             delete cleanedCustomizations[key];
             keysRemoved = true;
        }
    }

    // 2. 如果清理后对象为空，直接清空整个 colorCustomizations 键。
    const finalSettings = Object.keys(cleanedCustomizations).length === 0 ? undefined : cleanedCustomizations;

    if (keysRemoved) {
         await config.update('workbench.colorCustomizations', finalSettings, target);
         vscode.window.setStatusBarMessage('✅ UI Transparency Removed', 2000);
    }
}

    // ---- Helper: 解析并返回激活主题的 colors 对象（如果能找到） ----
    let _cachedThemeName: string | undefined = undefined;
    let _cachedThemeColors: { [key: string]: string } | undefined = undefined;

    async function loadActiveThemeColors(): Promise<{ [key: string]: string } | undefined> {
        try {
                const themeName = (vscode.workspace.getConfiguration('workbench').get('colorTheme') as string);
                if (!themeName) { return undefined; }

                if (_cachedThemeName === themeName && _cachedThemeColors) {
                    return _cachedThemeColors;
                }

            // 遍历已安装扩展，寻找贡献 theme 的扩展
            for (const ext of vscode.extensions.all) {
                const contributes = ext.packageJSON && ext.packageJSON.contributes;
                if (!contributes || !contributes.themes) { continue; }

                const themes = contributes.themes;
                for (const t of themes) {
                    const labels = [t.label, t.id, t.name].filter(Boolean).map(String);
                    if (labels.includes(themeName)) {
                        // 找到对应主题文件
                        const themePath = t.path || t.theme || t.file;
                        if (!themePath) { continue; }
                        const abs = path.isAbsolute(themePath) ? themePath : path.join(ext.extensionPath, themePath);
                        try {
                            const raw = fs.readFileSync(abs, 'utf8');
                            const json = JSON.parse(raw);
                            const colors = json.colors || json['workbench.colorCustomizations'] || undefined;
                            if (colors && typeof colors === 'object') {
                                _cachedThemeName = themeName;
                                _cachedThemeColors = colors;
                                return colors;
                            }
                        } catch (e) {
                            // ignore parse/read errors and continue
                            continue;
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Failed to load active theme colors:', e);
        }
        return undefined;
    }

    // ---- Helper: 规范化颜色字符串，返回 #RRGGBB 或 undefined ----
    function normalizeColorString(input: any): string | undefined {
        if (!input || typeof input !== 'string') { return undefined; }
        input = input.trim();
        // Hex #RRGGBB or #RGB or #RRGGBBAA
        if (/^#[0-9A-Fa-f]{6}$/.test(input)) { return input.toUpperCase(); }
        if (/^#[0-9A-Fa-f]{3}$/.test(input)) {
            const r = input[1];
            const g = input[2];
            const b = input[3];
            return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
        }
        if (/^#[0-9A-Fa-f]{8}$/.test(input)) {
            return input.substring(0, 7).toUpperCase();
        }
        // rgba(...) or rgb(...)
        const rgba = input.match(/rgba?\(([^)]+)\)/i);
        if (rgba) {
            const parts = rgba[1].split(',').map((p: string) => p.trim());
            if (parts.length >= 3) {
                const r = Math.max(0, Math.min(255, parseInt(parts[0], 10) || 0));
                const g = Math.max(0, Math.min(255, parseInt(parts[1], 10) || 0));
                const b = Math.max(0, Math.min(255, parseInt(parts[2], 10) || 0));
                const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
                return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
            }
        }
        // Unknown format
        return undefined;
    }
