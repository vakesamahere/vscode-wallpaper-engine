import * as vscode from 'vscode';

// 【透明化目标列表】所有可能遮挡壁纸的 UI 元素 Key
const TRANSPARENT_COLOR_KEYS = [
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

    // 1. 获取现有颜色自定义设置
    // 目标是针对全局生效 (不在任何 [Theme Name] 括号内)
    const existingCustomizations = config.get<any>('workbench.colorCustomizations') || {};

    // 2. 定义新的透明规则
    const transparencyRules: { [key: string]: string } = {};
    for (const key of TRANSPARENT_COLOR_KEYS) {
        // #00000000 代表 R=00, G=00, B=00, A=00 (完全透明)
        transparencyRules[key] = "#00000000"; 
    }

    // 3. 合并：保留用户原有设置，并应用我们的透明规则
    const newCustomizations = {
        ...existingCustomizations, // 保留用户已有的定制颜色
        ...transparencyRules // 覆盖目标背景元素为透明
    };

    // 4. 更新设置 (使用 Global 作用域，对所有主题生效)
    try {
        await config.update('workbench.colorCustomizations', newCustomizations, target);
        vscode.window.showInformationMessage('✅ UI 元素透明化补丁已自动应用至 settings.json。');
    } catch (error) {
        vscode.window.showErrorMessage('❌ 无法自动修改 settings.json。');
        console.error("Settings update failed:", error);
    }
}

/**
 * 移除我们设置的所有透明度规则。
 */
export async function removeTransparencyPatch() {
    const config = vscode.workspace.getConfiguration();
    const existingCustomizations: any = config.get('workbench.colorCustomizations') || {};
    
    const cleanedCustomizations = { ...existingCustomizations };

    // 1. 移除我们添加的所有透明度键
    let keysRemoved = false;
    for (const key of TRANSPARENT_COLOR_KEYS) {
        if (cleanedCustomizations[key] && cleanedCustomizations[key] === "#00000000") {
             delete cleanedCustomizations[key];
             keysRemoved = true;
        }
    }

    // 2. 如果清理后对象为空，直接清空整个 colorCustomizations 键。
    const finalSettings = Object.keys(cleanedCustomizations).length === 0 ? undefined : cleanedCustomizations;

    if (keysRemoved) {
         await config.update('workbench.colorCustomizations', finalSettings, vscode.ConfigurationTarget.Global);
         vscode.window.showInformationMessage('✅ UI 元素透明化设置已移除。');
    }
}
