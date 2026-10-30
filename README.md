# AuraLine — 隐身声学细线 (Tauri v2 + Rust 声卡直连版)

> **AuraLine** 是一款专为办公电脑与 **QQ 音乐桌面歌词** 设计的超极简实时声学流体细线伴侣。
> 采用 **Tauri v2 + Rust (`cpal` + `rustfft`)** 原生桌面架构，启动即全自动静默直连系统默认声卡（Windows WASAPI Loopback / macOS CoreAudio），**无任何手动音源切换按钮、无需浏览器权限弹窗、100% 本地内存分析、零云端上传**。

---

## ✨ 核心特性 (Features)

1. **开机/启动全自动直连声卡 (Zero-Click Soundcard Loopback)**
   - **原生桌面端 (`src-tauri/`)**：Rust 后端在启动时自动通过 `cpal::Host::default_output_device()` 挂载系统默认声卡输出流（Windows 下自动启用 WASAPI Loopback 内录回环），直接捕获 QQ 音乐等播放器的系统混音数据。
   - **Rust 原生 FFT 解算**：在 Rust 线程内直接完成 1024 点 Hann 窗 `rustfft` 频谱分析，计算三频段能量（低频鼓贝斯、中频人声主音、高频弦乐泛音）、RMS 分贝、主频音高与瞬态节拍（Beat Onset），仅通过 Tauri IPC 发送轻量级标量数据（~30 FPS），CPU 占用低于 0.5%。
   - **界面零音源按钮**：前端移除所有手动音源选择按钮，打开即用。

2. **三频段乐器声学流体 + 节奏闪烁 + -40dB 极细音量条**
   - **左侧低频流体 (`20–250 Hz`)**：映射底鼓 (Kick) 与贝斯 (Bass) 的深沉呼吸脉动。
   - **中置游走高光 (`250–2500 Hz`)**：跟随人声/钢琴/吉他主频音高 (`dominantFreq`) 在细线中水平平滑游走。
   - **右侧高频星尘 (`2.5k–14k Hz`)**：映射弦乐、ハイハット (Hi-Hat) 与齿音泛音，高频充沛时浮现最多 3 颗微米级星尘粒子。
   - **节拍瞬时闪烁 (`telemetry.isBeat`)**：检测到鼓点瞬态时，细线产生 `1.22x` 瞬时微加粗、核心提亮与边缘微光扩散。
   - **-40dB 底部极细音量进度条**：位于细线底部边缘的 `1.5px` 动态进度条，**仅当实时音量 `> -40dB` 时浮现**，静音时完全隐身。

3. **办公级低功耗自动休眠 (`Auto-Sleep`)**
   - 当检测到连续无声（`< -48 dB`）达到设定时长（支持 `5秒 / 10秒 / 30秒 / 60秒`），Canvas 渲染循环自动切换为 **`0 FPS` 完全冻结** 或 **`2 FPS` 超低功耗待机**；一旦 QQ 音乐重新播放，毫秒级自动唤醒。

4. **四款桌面壁纸色彩预设 & 纯细线隐身模式**
   - **极简白 (`minimal_white`)**、**深海静谧 (`deep_sea`)**、**活力律动 (`vibrant_pulse`)**、**森屿微光 (`forest_mist`)**。
   - 支持一键切换 **纯细线模式 (`Alt + H`)** 与 **桌面透明穿透 (`Click-Through`)**，可直接吸附在 QQ 音乐桌面歌词正下方或屏幕底边。

---

## 📁 仓库目录结构 (Project Structure)

```text
├── src-tauri/                        # Tauri v2 + Rust 原生桌面端工程目录
│   ├── Cargo.toml                    # Rust 依赖配置 (tauri v2, cpal, rustfft, serde)
│   ├── build.rs                      # Tauri 构建脚本
│   ├── tauri.conf.json               # 无边框、透明背景、置顶、跳过任务栏窗口配置 (440x84)
│   ├── capabilities/
│   │   └── default.json              # Tauri v2 窗口置顶、拖拽与事件监听权限配置
│   └── src/
│       ├── main.rs                   # Windows 子系统入口
│       ├── lib.rs                    # Tauri 启动钩子：自动拉起声卡监听线程 + 鼠标穿透命令
│       └── audio_loopback.rs         # 核心：cpal 声卡 Loopback 采集 + rustfft 1024点频谱与节拍解算
├── src/                              # React 19 + TypeScript + Tailwind CSS 前端视图层
│   ├── types/
│   │   └── audio.ts                  # AudioTelemetry、StealthLineSettings 与四套色彩预设定义
│   ├── services/
│   │   └── audioEngine.ts            # 全自动连接引擎：优先监听 Tauri IPC 'audio-telemetry' 事件
│   ├── components/
│   │   └── MiniAuraWidget.tsx        # 隐身声学细线 Canvas 渲染组件 (Beat 闪烁 + -40dB 音量条 + 自动休眠)
│   └── App.tsx                       # 极简主界面：仅保留隐身细线与底栏色彩/尺寸/休眠微调
├── index.html
├── package.json
└── vite.config.ts
```

---

## 🚀 本地编译与运行指南 (For Local Developer / Coding Agent)

### 1. 环境准备 (Prerequisites)
1. **Node.js** `>= 18`
2. **Rust 工具链**：安装 [rustup](https://rustup.rs/)（Windows 需安装 MSVC C++ 生成工具）
3. **Tauri CLI**：可直接使用 `npx @tauri-apps/cli` 或通过 `cargo install tauri-cli` 安装

### 2. 安装前端依赖
```bash
npm install
```

### 3. 启动原生桌面端开发模式 (自动直连声卡)
```bash
# 安装 Tauri CLI 与前端 API 绑定（如尚未安装）
npm install -D @tauri-apps/cli
npm install @tauri-apps/api

# 启动 Tauri + Rust 桌面悬浮窗（自动编译 src-tauri 并直连系统声卡）
npx tauri dev
```

### 4. 打包独立桌面可执行程序 (`.exe` / `.dmg`)
```bash
npx tauri build
```
打包完成后，独立安装包与可执行文件位于：
- **Windows**: `src-tauri/target/release/auraline-desktop.exe`
- **macOS**: `src-tauri/target/release/bundle/macos/AuraLine.app`

---

## 🛠️ 给本地 Coding Agent 的后续扩展提示 (Agent Hand-off Notes)

1. **真实启用 `@tauri-apps/api` 动态绑定**：
   - `src/services/audioEngine.ts` 已内置对 `window.__TAURI_INTERNALS__` 和 `window.__TAURI__` 的自动检测，无须修改业务组件即可直接接收 Rust 端 `app.emit("audio-telemetry", payload)` 推送的实时声卡数据。
2. **鼠标穿透 (`Click-Through`) 快捷键支持**：
   - Rust 端 `src-tauri/src/lib.rs` 已注册 `#[tauri::command] fn set_click_through(window: tauri::Window, ignore: bool)`，如需在纯细线模式下开启完全鼠标穿透，可在前端直接调用 `invoke('set_click_through', { ignore: true })`，并配合 `tauri-plugin-global-shortcut` 注册全局快捷键恢复交互。
3. **声卡重连与设备切换容错**：
   - 如果办公电脑在耳机/扬声器之间拔插切换，可在 `src-tauri/src/audio_loopback.rs` 的流错误回调 `err_fn` 中触发重新获取 `host.default_output_device()`，实现耳机拔插无缝热切换。
