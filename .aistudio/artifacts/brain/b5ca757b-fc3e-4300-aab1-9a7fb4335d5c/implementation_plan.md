# AuraLine — 桌面体验与声卡底层四项终极优化方案

本方案将您确认的四项优化全部整合进 `AuraLine-Portable.exe`，消除 Windows 暂停播放时的尾音残留问题，并补齐办公隐蔽度调节、鼠标手势、防多开保护与开机自启能力。

---

## User Review & Critical Decisions

> [!IMPORTANT]
> 本次升级包含您勾选确认的全部 4 项核心优化：

- **Confirmed Decision 1（修复暂停音乐时 WASAPI 停止回调导致光晕不归零与不休眠）**：
  - 在 Rust 声卡线程与前端声学引擎中同时引入 **`140ms` 断流静音心跳与平滑衰减机制**：当 QQ 音乐暂停播放、Windows WASAPI 停止触发音频回调时，细线光晕在 `0.15 秒` 内丝滑回落至静默态（`-60dB`），并准时触发 `0 FPS` 自动休眠。
- **Confirmed Decision 2（新增 20%–100% 整体透明度调节）**：
  - 在独立设置窗口中新增 **“整体不透明度 (20%–100%)”** 滑块，可随时将桌面细线调至极淡的半透明状态（如 `30%`），兼顾办公室白天的极致隐蔽性。
- **Confirmed Decision 3（细线手势交互：滚轮调透明度 + 双击打开设置）**：
  - **鼠标滚轮**：将鼠标移到细线上滚动滚轮，即可直接以 `±5%` 步进实时调节细线整体透明度。
  - **鼠标双击**：双击细线任意位置，直接弹出独立的原生设置窗口。
- **Confirmed Decision 4（防多开单实例保护 + 开机自启开关）**：
  - **防多开保护**：当程序已在运行时，再次双击 `AuraLine-Portable.exe` 不会启动第二个重叠窗口，而是自动唤醒已有实例的设置窗口并退出新进程。
  - **开机自启开关**：在右下角系统托盘菜单与独立设置页面中同步提供 **“开机自动启动”** 开关（基于当前用户 `HKCU` 注册表项，无需管理员权限）。

---

## 1. Overview & Core Concept

- **What It Does**：让 `AuraLine-Portable.exe` 在 Windows 办公电脑上具备真正商业级桌面软件的稳定性与顺手交互——暂停即静默休眠、滚轮即调隐蔽度、双击即改设置、开机自动常驻且绝不重复多开。
- **Target Audience / Persona**：追求极致省心、每天开机即用 QQ 音乐办公听歌的桌面用户。
- **Key Value**：解决 Windows WASAPI 暂停无回调的底层痛点，并提供零学习成本的直觉手势与系统级常驻体验。

---

## 2. User Experience & Visual Design

- **Key User Flows**：
  1. **暂停即归零休眠**：QQ 音乐暂停后，细线光晕与 `-40dB` 音量条在 `0.15s` 内平滑消退；达到设定的静音时长（如 10s）后自动冻结为 `0 FPS`。
  2. **滚轮与双击手势**：在桌面上无需打开设置页，鼠标指在细线上滚轮上下滑动即可让细线变淡/变亮（`20%–100%`）；双击细线立即弹出设置窗口。
  3. **防多开与开机自启**：误触再次双击 `.exe` 时自动呼出设置面板而不会产生两条重叠细线；在设置页或托盘右键菜单一键开启“开机自动启动”。

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1：零外部依赖的 Rust 原生单实例锁与开机自启实现**
  - *Chosen Approach*：使用本地回环端口监听实现单实例互斥与唤醒信号传递；使用 Windows 原生 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 静默注册开机自启，不引入任何容易导致云端编译冲突的第三方插件。
  - *Why*：保证 GitHub Actions 云端编译 100% 稳定通过，同时无需管理员权限即可在受限办公电脑上正常启用开机自启。

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                Standalone Windows .exe (Tauri v2 + Rust)                │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Rust Native Core                                                  │  │
│  │  • Single-Instance Guard: Local loopback lock -> wakes existing   │  │
│  │  • WASAPI Watchdog: 100ms tick -> emits silence after 140ms idle  │  │
│  │  • Auto-Start Manager: HKCU\...\Run\AuraLine query/set/remove     │  │
│  │  • System Tray: Open Settings / Auto-Start / Click-Through / Quit │  │
│  └───────────────────────────────┬───────────────────────────────────┘  │
│                                  │ Tauri IPC                            │
│                                  ▼                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Desktop Bar Window (main) & Standalone Settings Window            │  │
│  │  • Smooth Silence Decay: Melts glow in 150ms when audio pauses    │  │
│  │  • Gesture Layer: onWheel (20%..100% Opacity) + onDoubleClick     │  │
│  │  • Settings Window: Master Opacity + Auto-Start Toggle + Presets  │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**：
  - `StealthLineSettings.masterOpacity`：`0.20` 至 `1.00` 的浮点数（默认 `1.0`），控制桌面细线整体不透明度。
  - `AutoStartStatus`：布尔值，反映当前 `.exe` 路径是否已写入当前用户开机启动项。
