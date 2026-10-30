# AuraLine — 100% 开箱即用 Tauri v2 + Rust 声卡直连完整实装方案

本方案将此前写在 `README.md` “后续扩展提示”中的所有待办项（`@tauri-apps/api` 官方 SDK 绑定、`tauri.conf.json` 全局 IPC 桥接、Rust 声卡热拔插自动重连、以及桌面鼠标穿透控制）**全部一次性实装到当前仓库中**，确保您克隆仓库后只需执行 `npm install && npx tauri dev` 即可 100% 零修改直接运行。

---

## User Review & Critical Decisions

> [!IMPORTANT]
> 本次升级将消除所有“预留接口”或“需手动安装补充包”的步骤，把前后端与 Rust 声卡底层彻底打通为成品状态：

- **Confirmed Decision 1（内置官方 `@tauri-apps/api` 与 `withGlobalTauri: true` 双重绑定）**：直接在项目依赖中预装 `@tauri-apps/api` 与 `@tauri-apps/cli`，并在 Tauri 配置中开启 `"withGlobalTauri": true`。前端声学引擎将直接使用官方 `@tauri-apps/api/event` 的 `listen` 与 `@tauri-apps/api/core` 的 `invoke`，同时向下兼容全局对象与浏览器预览回退。
- **Confirmed Decision 2（Rust 声卡耳机/扬声器热拔插自动重连）**：在 Rust 音频采集线程中加入设备状态监控与断流自动重连循环——当办公电脑插入/拔出耳机或切换默认播放设备时，无需重启软件，2 秒内自动无缝挂载新声卡。
- **Confirmed Decision 3（原生无边框窗口拖拽与鼠标穿透控制）**：在微调栏与纯细线模式中实装真实的 Tauri `set_click_through` 调用与窗口拖拽支持，让细线真正贴合在 QQ 音乐桌面歌词下方。

---

## 1. Overview & Core Concept

- **What It Does**：**AuraLine** 是一根贴合在 QQ 音乐桌面歌词下方的 `360 × 8 px` 隐身声学细线。启动后由 Rust 原生线程直接从系统默认声卡（WASAPI Loopback / CoreAudio）捕获实时音频，通过 1024 点 FFT 解算低/中/高三频段流体光晕、主音音高游走、鼓点瞬时加粗闪烁与 `-40dB` 极细实时音量条。
- **Target Audience / Persona**：在办公电脑上使用 QQ 音乐听歌、追求极致桌面隐蔽性与超低 CPU 占用（静音自动 0 FPS 休眠）的用户。
- **Key Value**：100% 开箱即用，克隆仓库后无需再手动安装额外 Tauri 依赖或补写任何桥接代码。

---

## 2. User Experience & Visual Design

- **Key User Flows**：
  1. **零操作启动直连**：程序启动后，Rust 后台自动挂载系统默认输出声卡并推送 `"audio-telemetry"` 实时数据流；界面无任何冗余的“选择音源”按钮。
  2. **耳机/音箱无缝切换**：办公中途插拔耳机或蓝牙音箱时，Rust 守护循环自动重新捕获新的默认输出设备，细线律动不中断。
  3. **微调与隐身穿透**：底部单行极简微调栏提供 4 套壁纸色彩预设（极简白、深海静谧、活力律动、森屿微光）、长宽调节、自动休眠定时与**窗口锁定/鼠标穿透**开关；按 `Alt + H` 可完全隐藏微调栏，仅留桌面细线。
- **Visual Identity & Theme**：
  - *Aesthetic Direction*：极致内敛的声学微件（Atmospheric Minimalism & High-Craft UI）。
  - *Color Palette & Mood*：深色模式采用 `#09090B` 哑光深空黑，浅色模式采用 `#F4F4F5` 极简雾白，Tauri 原生模式下支持全透明无边框悬浮。
  - *Typography & Hierarchy*：标题采用 `Outfit`，界面控制文字采用 `Plus Jakarta Sans`，分贝/尺寸/帧率等精密读数采用 `JetBrains Mono` (`tabular-nums`)。

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1：官方 `@tauri-apps/api` ES Module 导入 + 动态回退机制**
  - *Chosen Approach*：直接安装 `@tauri-apps/api`，在前端通过 `@tauri-apps/api/event` 的 `listen('audio-telemetry')` 和 `@tauri-apps/api/core` 的 `invoke('set_click_through')` 进行强类型调用，并在 `tauri.conf.json` 同步开启 `withGlobalTauri: true`。
  - *Why*：彻底避免 Tauri v2 默认关闭全局注入时导致的事件监听失效问题，同时保持在 Web 预览环境下的平滑兼容。
- **Decision 2：Rust 端声卡守护循环（Watchdog Reconnect Loop）**
  - *Chosen Approach*：当 `cpal` 音频流触发断开错误（如拔出 USB 耳机）或连续无回调脉冲时，Rust 采集线程自动销毁旧流并重新查询 `host.default_output_device()` 重建 WASAPI Loopback 流。
  - *Why*：办公电脑经常在扬声器与耳机之间切换，自动重连能保证全天候稳定运行而无需手动重启软件。

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    Tauri v2 Native Desktop Runtime                      │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Rust Backend (cpal + rustfft + Hot-Plug Watchdog Loop)            │  │
│  │  • Queries Host::default_output_device() (WASAPI Loopback)        │  │
│  │  • Auto-reconnects on device switch / stream error every 2s       │  │
│  │  • 1024-pt Hann FFT -> 3-Band Energy + Pitch + Beat + -40dB RMS   │  │
│  │  • Emits "audio-telemetry" via Tauri IPC (~30 FPS)                │  │
│  └───────────────────────────────┬───────────────────────────────────┘  │
│                                  │ @tauri-apps/api/event::listen        │
│                                  ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ React 19 Frontend Engine & Stealth Fine Line View                 │  │
│  │  • RealtimeAudioEngine: Native IPC listener + Spring physics      │  │
│  │  • MiniAuraWidget: 3-Band Fluid + Beat Flash + -40dB Volume Bar   │  │
│  │  • Auto-Sleep Controller: 0 FPS freeze / 2 FPS standby on silence │  │
│  │  • Window Controller: @tauri-apps/api/core::invoke Click-Through  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**：
  - `AudioTelemetryPayload`：包含 `rmsVolume`、`dbLevel`、`bassEnergy`、`midEnergy`、`trebleEnergy`、`dominantPitchHz`、`isBeat`、`waveformSlice`。
  - `StealthLineSettings`：持久化于 `localStorage`，管理色彩预设、细线长度/粗细、自动休眠阈值及省电策略。
- **Interactive Component & State Mapping**：
  - 启动时自动执行 `@tauri-apps/api/event` 的 `listen('audio-telemetry')` 绑定。
  - 用户点击微调栏中的“纯细线/穿透锁定”或按 `Alt + H` 时，同步管理 UI 隐藏状态与 Tauri 窗口命令。
