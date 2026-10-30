# AuraLine — 隐身声学细线 (独立 Windows `.exe` 原生桌面版 · 100% 零麦克风占用)

> **AuraLine** 是一款专为办公电脑与 **QQ 音乐桌面歌词** 设计的超极简实时声学流体细线伴侣。
> 编译后生成**完全脱离浏览器的独立 `AuraLine-Portable.exe` 原生桌面程序**，双击即可悬浮在桌面上运行，常驻 Windows 右下角系统托盘，自动记忆桌面坐标。

---

## 🔒 100% 物理级禁用麦克风声明 (Zero-Microphone Guarantee)

为了彻底保障办公电脑隐私安全，本项目在底层与前端均执行了**零麦克风访问策略**：
1. **Rust 底层 (`src-tauri/src/audio_loopback.rs`)**：100% 仅绑定 `host.default_output_device()`（即扬声器/耳机的播放输出流 WASAPI Loopback），**物理移除了所有对输入设备 (`default_input_device` / 麦克风) 的访问代码**。即使您插着耳麦或正在进行腾讯会议/飞书语音，本程序也绝不会触碰麦克风，Windows 任务栏更不会出现“正在使用麦克风”图标。
2. **前端与权限层 (`src/services/audioEngine.ts` & `metadata.json`)**：100% 移除了 `navigator.mediaDevices.getUserMedia` 与麦克风权限请求。

---

## 📦 如何直接获取独立 `.exe` 可执行文件？（两种方式）

### 方式一：通过 GitHub Actions 云端自动编译下载 `.exe`（最省心，办公电脑无需安装任何编译环境）

仓库已内置 `.github/workflows/build-windows-exe.yml` 云端自动打包流水线：
1. 将本项目代码推送（或同步）到您的 GitHub 仓库。
2. 打开您的 GitHub 仓库页面，点击顶部导航栏的 **`Actions`** 标签页。
3. 点击左侧的 **`Build Windows Standalone EXE`**（它会在每次提交代码时自动运行，您也可以点击右侧 `Run workflow` 手动触发）。
4. 编译完成后（约 3–5 分钟），在任务页面底部的 **`Artifacts`** 区域直接点击下载：
   - **`AuraLine-Portable-exe`**：内含免安装绿色单文件 **`AuraLine-Portable.exe`**，无需管理员权限，解压后在任何 Windows 10/11 办公电脑上**双击即可直接脱离浏览器运行**！
   - **`AuraLine-Windows-Installer`**：内含标准 Windows 安装包（`*-setup.exe` / `.msi`）。

---

### 方式二：在本地电脑双击 `build-exe.bat` 一键打包 `.exe`

如果您的电脑已安装 Node.js 和 Rust（[rustup.rs](https://rustup.rs/)）：
1. 直接双击仓库根目录下的 **`build-exe.bat`** 脚本（或在终端运行 `npm run tauri:build`）。
2. 脚本会自动安装依赖、生成 Windows `.ico` 图标并编译出原生 `.exe`。
3. 编译完成后，根目录会自动生成 **`AuraLine-Portable.exe`**，双击即可运行。

---

## 🖥️ 独立 `.exe` 桌面运行与系统托盘指南

1. **开机/启动全自动连声卡输出 + 耳机拔插自动重连**：
   - 双击 `AuraLine-Portable.exe` 启动后，程序自动监听当前默认扬声器/耳机的音乐播放信号；中途插拔 USB/蓝牙耳机时，2 秒内自动无缝切换，无需重启。
2. **拖拽贴合 QQ 音乐歌词 + 屏幕坐标自动记忆**：
   - 按住细线可直接拖动到 QQ 音乐桌面歌词正下方，松手后自动记录屏幕物理坐标 `(x, y)`，下次启动 `.exe` 时自动恢复到该位置。
3. **Windows 右下角系统托盘右键菜单（System Tray）**：
   - 程序运行时隐藏任务栏大图标（`skipTaskbar: true`），并在 **Windows 右下角系统托盘（时间/音量旁）** 显示专属声学细线图标。
   - **左键点击托盘图标**：立即唤醒窗口并展开底部微调栏（若处于鼠标穿透状态会自动解除穿透）。
   - **右键点击托盘图标**，可随时呼出原生系统菜单：
     - `显示 / 隐藏底部微调栏 (Alt+H)`
     - `开启 / 解除鼠标穿透锁定`（开启后鼠标点击直接穿透到下层办公软件）
     - `色彩预设：极简白 / 深海静谧 / 活力律动 / 森屿微光`
     - `重置细线到屏幕底部中央`（外接显示器拔出后一键找回窗口）
     - `退出 AuraLine`

---

## 📁 仓库目录结构 (Project Structure)

```text
├── .github/workflows/
│   └── build-windows-exe.yml         # GitHub Actions 云端自动编译 Windows .exe 流水线
├── build-exe.bat                     # Windows 本地一键编译 .exe 批处理脚本
├── src-tauri/                        # Tauri v2 + Rust 原生桌面端工程目录
│   ├── Cargo.toml                    # Rust 依赖配置 (tauri v2 + tray-icon, cpal, rustfft)
│   ├── tauri.conf.json               # 无边框、透明、置顶、跳过任务栏 + withGlobalTauri: true
│   ├── icons/                        # Windows .ico / .png 应用与系统托盘图标
│   └── src/
│       ├── main.rs                   # Windows 子系统入口 (隐藏黑框控制台)
│       ├── lib.rs                    # 右下角系统托盘菜单 + 窗口坐标记忆 + 鼠标穿透命令
│       └── audio_loopback.rs         # 核心：100% 仅限扬声器输出回环 + 耳机热拔插重连 + rustfft
└── src/                              # 隐身细线渲染与微调视图层
    ├── services/audioEngine.ts       # Tauri IPC 声卡数据流 + 托盘指令同步 + 窗口坐标记忆
    ├── components/MiniAuraWidget.tsx # 三频流体 + isBeat 节奏闪烁 + -40dB 极细音量条 + 自动休眠
    └── App.tsx                       # 极简主界面与微调栏
```
