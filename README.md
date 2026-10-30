# AuraLine — 任务栏自适应老式车载 VFD 频谱仪 (独立 Windows `.exe` 原生桌面版 · 100% 零麦克风占用)

> **AuraLine** 是一款专为 Windows 10/11 任务栏设计的**老式汽车音响分段式 VFD 荧光频谱柱状图 (`32Hz–16kHz` 对数音调均衡器 + 顶部 Peak-Hold 峰值悬停掉落小方块)**。
> 编译后生成**完全脱离浏览器的独立 `AuraLine-Portable.exe` 原生桌面程序**，双击后直接嵌入在系统任务栏空白处，自动感知任务栏搜索框与打开软件图标的位置边界并动态避让！

---

## ✨ 核心特性 (Key Highlights)

1. **老式车载机头 VFD 分段灯珠 + 顶部峰值悬停掉落小方块 (Peak-Hold)**：
   - 基于 Rust `rustfft` 1024 点 Hann 窗实时对数频谱分析，将 `32Hz` 超低音鼓点至 `16kHz` 清脆高音划分为最多 **32 根独立音调柱**。
   - 每根音调柱由经典车载 VFD 分段荧光格构成（底部冰青色 / 中段琥珀黄 / 顶部峰值红），并在柱顶配有**悬停 250ms 后按重力缓慢下落的 Peak-Hold 峰值方块**。
2. **Win32 任务栏图标与搜索框边界实时感知 (`src-tauri/src/taskbar_layout.rs`)**：
   - 自动定位 Windows 任务栏 (`Shell_TrayWnd`) 与右侧托盘 (`TrayNotifyWnd`)，并通过轻量级 5px 扫描线实时检测任务栏上已打开软件图标与搜索框的最右侧边界 (`icons_right_x`)。
   - 当您打开更多软件导致任务栏图标变多时，频谱仪会**自动向右平移避让**；当剩余空白变窄时，会**自动将频谱柱从 32 段平滑缩减为 24 / 16 / 12 段**，绝不遮挡任何任务栏图标或搜索框。
3. **100% 物理级禁用麦克风 (Zero-Microphone Guarantee)**：
   - Rust 底层 (`src-tauri/src/audio_loopback.rs`) 100% 仅绑定 `host.default_output_device()`（扬声器/耳机 WASAPI Loopback），物理移除一切麦克风输入访问代码。

---

## 📦 如何获取独立 `.exe` 可执行文件？

1. **GitHub Actions 云端自动编译**：推送代码至 GitHub 后，在仓库顶部的 **`Actions` -> `Build Windows Standalone EXE`** 页面底部直接下载 **`AuraLine-Portable-exe`**（内含免安装单文件 `AuraLine-Portable.exe`）。
2. **本地一键编译**：在已安装 Node.js 与 Rust 的 Windows 电脑上双击根目录的 **`build-exe.bat`**，即可生成 **`AuraLine-Portable.exe`**。
