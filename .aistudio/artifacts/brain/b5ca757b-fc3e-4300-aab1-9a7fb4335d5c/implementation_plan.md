# 播放时（使用期间）CPU 占用深度优化方案 (Implementation Plan)

## 1. 播放期间持续 CPU 热点剖析

在持续播放音乐或视频时，以下 4 个高频执行路径决定了 CPU 的实时负载：

1. **音频回调在节流间隔内仍在做无效的 1024 点 FFT 运算 (`/src-tauri/src/audio_loopback.rs`)**
   - WASAPI 环回流每 `10ms`（每秒 100 次）触发一次回调。当前代码虽然将 IPC 发送节流到了 `32ms`（约 30Hz），但在未满 `32ms` 的分支里仍然调用了 `guard.process_scratch_block(...)`，意味着每秒仍在后台执行 **50~100 次 1024 点复数 FFT + 512 次开方 + 32 次对数幂函数**，而其中约 2/3 的计算结果被直接丢弃。

2. **Canvas 每帧 700+ 次矩形绘制指令 (`fillRect`) 与无脏帧跳过 (`/src/components/MiniAuraWidget.tsx`)**
   - 每帧重绘时，不仅要绘制动态亮起的频谱段，还要用双重循环逐格重绘 `32 柱 × 12 段 = 384 个` 静态暗色背景底格（`ghostCellColor`），导致每帧高达 700+ 次 GPU/Canvas 2D 状态提交。
   - 当相邻两帧的各柱亮起格数 (`litCount`) 和峰值位置 (`peakIndex`) 完全未变时，仍然全量清空并重绘整个画布。

3. **前端同时运行两个独立的 `requestAnimationFrame` 循环 (`/src/App.tsx` + `/src/components/MiniAuraWidget.tsx`)**
   - `App.tsx` 运行一个 `requestAnimationFrame(tick)` 循环来调用 `engine.sampleTelemetry(...)`，而 `MiniAuraWidget.tsx` 又运行另一个 `requestAnimationFrame(render)` 循环。在 60Hz/144Hz 显示器上，每秒触发 120~288 次 JS 帧回调调度。

4. **任务栏扫描器在窗口几何未变时仍定期触发 GDI `BitBlt` (`/src-tauri/src/taskbar_layout.rs`)**
   - 即使任务栏窗口与托盘通知区句柄矩形完全未变，且已获得稳定的槽位坐标，后台线程仍每 2 秒向 DWM 请求一次 `BitBlt` 屏幕拷贝。

---

## 2. 深度优化方案 (Proposed Changes)

### A. Rust 音频线程：未到发送时间直接跳过 FFT 计算 (`/src-tauri/src/audio_loopback.rs`)
- 在 `push_and_emit` 中，先将声卡采样推入 `ring_buffer`（保留最新的 `1024` 个采样点），然后**先判断 `now_ms.saturating_sub(guard.last_emit_ms) < 33`**：
  - 若距离上次发送不足 `33ms`，**直接返回 `None`，完全不执行 `process_scratch_block`（跳过 Hann 窗、1024 点 FFT、幅度谱开方与分频段幂运算）**。
  - 仅在达到 `33ms` 周期时，从 `ring_buffer` 尾部提取最新 `1024` 个样本执行 **1 次** FFT 并发送 IPC。这可将音频后台线程在播放期间的 CPU 运算量直接削减 **65% ~ 75%**。

### B. 离屏 Canvas 精灵缓存 (Offscreen Sprite Caching) + 脏帧跳过 (`/src/components/MiniAuraWidget.tsx`)
- **离屏预渲染暗色背景格栅与满格亮起灯柱**：
  - 在画布尺寸或主题变化时，一次性在内存离屏 Canvas (`bgGridCanvas`) 上绘制好全部静态暗色 VFD 底格；并在另一个仅 `colWidth × vfdHeight` 大小的离屏精灵 (`litColCanvas`) 上预渲染好一根满格亮起的三色渐变灯柱。
  - **每帧绘制指令从 700+ 次骤降至 ~33 次**：每帧先用 **1 次 `ctx.drawImage(bgGridCanvas, 0, 0)`** 铺满全部背景底格，再对每根有能量的柱子用 **1 次 `ctx.drawImage` 裁剪贴图** 画出亮起部分。
- **帧级脏检查 (Dirty-Frame Skip)**：
  - 记录每一柱的 `(litCount, peakIndex)` 签名与底部音量条宽度。如果当前帧所有柱子的亮起格数和峰值块位置与上一帧完全一致，**直接跳过本帧 Canvas 绘制**。

### C. 合并采样与渲染循环 + 默认启用 30FPS 车载省电模式 (`/src/App.tsx`, `/src/types/audio.ts`)
- **默认开启 30FPS 车载模式**：在 `/src/types/audio.ts` 中将 `DEFAULT_SETTINGS.workLowPower30Fps` 默认设为 `true`（约 30FPS，帧间隔 `33ms`，与后端 30Hz 音频包完美同步，用户仍可在设置中随时切换）。
- **降低主采样循环频率**：在 `/src/App.tsx` 中用自适应定时器替代 60Hz/144Hz 的空转 `requestAnimationFrame`，消除高刷显示器下的空转回调开销。

### D. 任务栏扫描器：稳态降频与跳过冗余 `BitBlt` (`/src-tauri/src/taskbar_layout.rs`)
- 当任务栏已完成初始对齐且连续稳定（`stable_icons_right_x` 已锁定、任务栏矩形 `tray_rect` 与托盘 `notify_left_x` 未发生变动）时，跳过高频 GDI `BitBlt` 截屏，将像素复核周期拉长至 `6000ms`（6 秒），仅在检测到任务栏窗口矩形变化或用户调整设置时立即执行像素扫描。

---

## 3. 验证计划 (Verification Plan)
1. 运行 `compile_applet` 与 `lint_applet` 验证前后端构建与类型安全。
2. 确认离屏 Canvas 渲染视觉效果与原逐格绘制 100% 一致（保留冰青/琥珀/绯红分段与峰值悬浮下落动画），同时大幅降低播放期间的 CPU 占用。
