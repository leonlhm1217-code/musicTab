# AuraLine — 独立原生 Windows `.exe` 打包流水线与系统托盘完整方案（100% 禁用麦克风纯净版）

本方案为您提供**完全脱离浏览器的独立 `.exe` 原生桌面程序交付链路**，并严格执行 **100% 零麦克风访问策略（物理级禁用一切麦克风/输入设备调用）**：程序**仅捕获系统扬声器/耳机的播放输出流（WASAPI Output Loopback）**，绝不触碰任何麦克风设备。同时内置 **GitHub Actions 云端自动编译 `.exe`**、**本地一键打包脚本**、**Windows 右下角系统托盘菜单**与**窗口位置自动记忆**。

---

## User Review & Critical Decisions

> [!IMPORTANT]
> 已将您提出的“**绝不监听麦克风**”作为最高优先级安全约束写入架构设计：

- **Confirmed Decision 1（100% 禁用麦克风，仅捕获系统播放输出流）**：
  - **Rust 原生层 (`audio_loopback.rs`)**：彻底移除任何 `default_input_device()`（麦克风/录音输入设备）回退代码，**100% 仅绑定 `host.default_output_device()`（扬声器/耳机输出端 WASAPI Loopback）**。即使电脑插着耳麦或正在开语音会议，程序也绝不会打开或读取麦克风，Windows 任务栏更不会出现“某应用正在使用麦克风”的隐私提示。
  - **前端与权限层 (`audioEngine.ts` & `metadata.json`)**：彻底移除浏览器端的 `navigator.mediaDevices.getUserMedia` 麦克风调用与麦克风权限声明，从根源上杜绝任何麦克风监听行为。
- **Confirmed Decision 2（GitHub Actions 云端自动编译 `.exe` + 本地一键打包脚本）**：
  - 内置 GitHub Actions 自动化工作流：代码同步到 GitHub 后，由 GitHub 官方 Windows 云服务器自动编译生成免安装的绿色单文件 `AuraLine-Portable.exe` 与安装包，您只需在 GitHub Actions 页面点击下载即可直接在办公电脑双击运行。
  - 同时在仓库根目录提供 Windows 本地一键编译脚本 `build-exe.bat`。
- **Confirmed Decision 3（Windows 右下角系统托盘菜单 + 窗口位置自动记忆）**：
  - 提供 **Windows 右下角系统托盘图标与右键菜单**：支持一键切换 4 款色彩预设、开启/解除鼠标穿透、重置细线位置、显示/隐藏微调栏或退出 `.exe`。
  - 自动记忆细线在桌面上的屏幕物理坐标 `(x, y)`，下次启动 `.exe` 时自动恢复到上次停靠在 QQ 音乐桌面歌词下方的位置。

---

## 1. Overview & Core Concept

- **What It Does**：将隐身声学细线封装为独立的 Windows `.exe` 原生桌面悬浮程序，**仅对系统扬声器/耳机播放出去的音乐信号做回环频谱分析（绝不访问麦克风）**，常驻于 Windows 右下角系统托盘，零浏览器依赖。
- **Target Audience / Persona**：在办公电脑上使用 QQ 音乐桌面歌词、高度重视办公隐私（严禁触碰麦克风）、希望双击一个轻量级 `.exe` 即可静默运行的桌面用户。
- **Key Value**：100% 纯净输出回环监听（零麦克风调用），免本地编译环境直接通过 GitHub 云端获取 `.exe`，并配备完整的 Windows 系统托盘控制与位置记忆。

---

## 2. User Experience & Visual Design

- **Key User Flows**：
  1. **直接获取并运行 `.exe`**：在 GitHub Actions 页面直接下载编译好的 `AuraLine-Portable.exe` 双击运行；程序无边框透明悬浮在桌面，右下角系统托盘出现专属图标，且**系统隐私栏全程无麦克风占用**。
  2. **纯输出声卡直连**：当 QQ 音乐播放歌曲时，细线实时读取耳机/扬声器的输出频谱呈现律动；当暂停播放时，无论您在办公室说话还是敲击键盘，细线均不会有任何反应，并在超时后进入 0 FPS 自动休眠。
  3. **拖拽贴合与位置记忆**：按住细线拖动到 QQ 音乐桌面歌词正下方，松手后自动保存屏幕坐标 `(x, y)`，下次启动 `.exe` 时精准停靠在同一位置。
  4. **系统托盘右键控制**：右键点击右下角托盘图标，可随时开启/解除鼠标穿透、切换 4 款配色、找回窗口位置或退出程序。

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1：硬编码锁定 `default_output_device()`，完全剔除输入设备接口**
  - *Chosen Approach*：在 Rust `cpal` 音频层仅查询 `host.default_output_device()`（播放设备），如果当前电脑没有任何播放设备（例如拔掉了所有耳机且无扬声器），线程将静默等待播放设备接入，而**绝不退回尝试打开输入设备 (`default_input_device`)**。
  - *Why*：确保在任何极端情况下都不会触碰用户的麦克风，保障办公电脑的绝对隐私安全。
- **Decision 2：同时输出免安装单文件 `Portable .exe` 与标准安装包**
  - *Chosen Approach*：在云端编译流水线中同时打包 `AuraLine-Portable.exe`（免安装绿色单文件，办公电脑无管理员权限也能双击即用）与标准安装包。
  - *Why*：方便在受限的办公电脑环境中零安装直接运行。

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                Standalone Windows .exe (Tauri v2 + Rust)                │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Rust Native Core (100% Output-Only, ZERO Microphone Access)       │  │
│  │  • Audio Loopback Thread: ONLY binds default_output_device()      │  │
│  │    (Speaker/Headphone WASAPI Loopback) + Hot-Plug Reconnect       │  │
│  │  • System Tray Manager: Native Menu (Presets / Click-Through /    │  │
│  │    Reset Position / Toggle Bar / Quit) -> emits "tray-command"    │  │
│  │  • Window Position Controller: Restores & persists screen (X, Y)  │  │
│  └───────────────────────────────┬───────────────────────────────────┘  │
│                                  │ Tauri IPC ("audio-telemetry" &       │
│                                  │            "tray-command")           │
│                                  ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Stealth Fine Line UI & State Engine (Zero getUserMedia Calls)     │  │
│  │  • MiniAuraWidget: 3-Band Fluid + Beat Flash + -40dB Volume Bar   │  │
│  │  • Position Memory: Saves/Restores Window OuterPosition on Move   │  │
│  │  • Tray Event Listener: Updates Theme / Click-Through / Controls  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │ Automated Build
┌──────────────────────────────────┴──────────────────────────────────────┐
│       GitHub Actions (windows-latest) & Local build-exe.bat             │
│  • Auto-generates app/tray icons -> Compiles Rust + Frontend            │
│  • Outputs standalone AuraLine-Portable.exe + NSIS Setup.exe            │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**：
  - `AudioTelemetryPayload`：仅来源于系统默认扬声器/耳机输出流（`default_output_device`）的 1024 点 FFT 频谱数据。
  - `TrayCommandPayload`：Rust 系统托盘菜单向前端广播的控制指令（`toggle-controls`、`toggle-click-through`、`set-theme:<id>`、`reset-position`）。
  - `SavedWindowPosition`：保存在本地的屏幕物理坐标 `{ x: number, y: number }`，在窗口移动结束时自动持久化，启动时自动恢复。
