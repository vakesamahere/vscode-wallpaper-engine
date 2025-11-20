import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as sudo from 'sudo-prompt';

const options = {
    name: 'VSCode Wallpaper Engine Extension',
};

// 尝试写入，如果失败则申请提权
export function saveFilePrivileged(filePath: string, content: string): Promise<void> {
    return new Promise((resolve, reject) => {
        // 先尝试直接写入 (如果用户本来就是管理员，或者是 Mac/Linux 用户且权限够)
        try {
            fs.writeFileSync(filePath, content, 'utf-8');
            resolve();
            return;
        } catch (err: any) {
            // 如果不是权限问题，直接抛出错误
            if (err.code !== 'EPERM' && err.code !== 'EACCES') {
                reject(err);
                return;
            }
        }

        // 权限不足，尝试提权写入
        const tempFilePath = path.join(os.tmpdir(), 'vscode_wallpaper_temp_' + Date.now());
        try {
            fs.writeFileSync(tempFilePath, content, 'utf-8');
        } catch (tempErr) {
            reject(new Error(`无法写入临时文件: ${tempErr}`));
            return;
        }

        // 移动命令
        let command = '';
        if (process.platform === 'win32') {
            // Windows 命令: move /Y "源" "目标"
            command = `move /Y "${tempFilePath}" "${filePath}"`;
        } else {
            // Mac/Linux 命令: mv -f "源" "目标"
            command = `mv -f "${tempFilePath}" "${filePath}"`;
        }

        // 提权执行
        sudo.exec(command, options, (error, stdout, stderr) => {
            if (fs.existsSync(tempFilePath)) {
                try { fs.unlinkSync(tempFilePath); } catch(e) {}
            }

            if (error) {
                reject(new Error(`提权写入失败: ${error.message}`));
            } else {
                resolve();
            }
        });
    });
}