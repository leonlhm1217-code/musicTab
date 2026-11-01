# Windows 任务栏右侧频谱边缘截断与溢出修复方案

## 1. 根因分析 (Root Cause Analysis)

经过排查 `src-tauri/src/taskbar_layout.rs`、`src/App.tsx` 与 `src/components/MiniAuraWidget.tsx`，确定导致打包后 Windows 桌面程序在任务栏右侧出现频谱边缘被截断及超出屏幕范围的根本原因有以下三点：

1. **Rust 端 `rx` 上界钳位公式严重缺陷 (Critical Clamp Flaw)**：
   - 在 `cfg.dock_mode == "before_tray"` 计算中：
     ```rust
     let slot_right = scan.notify_left_x - (8.0 * scale).round() as i32;
     let win_w = avail.min(max_total_w_phys).max(min_total_w_phys);
     let rx = (slot_right - win_w + offset_x_phys)
         .clamp(scan.tray_rect.left + 8, (slot_right - min_total_w_phys).max(scan.tray_rect.left + 8));
     ```
   - 此处钳位上限错误地使用了 `slot_right - min_total_w_phys`（例如 slot_right - 160），而非实际窗口宽度 `slot_right - win_w`（例如 slot_right - 340）。
   - 一旦实际窗口宽度 `win_w` 大于最小宽度（默认 desired_width 为 320px），或者配置了 `offset_x` 偏移，计算出的窗口右边缘 `rx + win_w` 将直接超出 `slot_right` 达 120~180 像素，导致窗口直接冲出屏幕右边缘或深入系统托盘区。

2. **Windows 11 系统托盘 `TrayNotifyWnd` 兼容性与高 DPI 探测失准**：
   - 在 Windows 11 (22H2/23H2/24H2) 中，任务栏系统托盘部分由 XAML Island / 新版通知控制组件管理，当 `FindWindowExW(tray_hwnd, 0, "TrayNotifyWnd", ...)` 未能获取准确左边界时，代码直接 fallback 到了未缩放的固定值 `tray_rect.right - 220`。
   - 在 125%、150% 或 200% 高 DPI 缩放下，Windows 11 的时钟、快速操作中心、输入法及折叠托盘箭头往往占据 320~440 物理像素。220px 的写死 fallback 使得 `notify_left_x` 严重偏右，将停靠槽位强行推入时钟与操作中心上方。

3. **前端容器内边距预算与 `overflow-hidden` 裁切**：
   - `taskbar_layout.rs` 派发的 `availableWidth` 为 logical 宽度，而 `App.tsx` 的外层容器使用了 `px-1` (左右各 4px = 8px)，且外层容器配置了 `overflow-hidden`。
   - `MiniAuraWidget` 画布宽度直接采用 `effectiveWidth`。画布自身宽度加上左右 8px 容器内边距后，总内容尺寸超越了 Tauri 的物理窗口可视宽度，导致高频右侧的柱体或 Peak Cap 被 `overflow-hidden` 硬件裁切。

---

## 2. 详细改造计划 (Implementation Steps)

### 步骤 1：修复 Rust 端右边界硬约束与托盘区域高 DPI 自适应探测 (`src-tauri/src/taskbar_layout.rs`)
- **托盘左边界动态安全探测**：
  - 引入基于 DPI 缩放的托盘保留区间预算：默认托盘保留物理像素设为 `(320.0 * scale).round() as i32`（高 DPI 下自动扩展至 400~480px）。
  - 若 `TrayNotifyWnd` 窗口句柄探测成功，同时检查其子窗口（如时钟、操作中心）或采用 `notify_rect.left` 与 DPI 安全底线的保守取较小值（更靠左），防止穿透。
- **重构 `before_tray` 模式定位算法**：
  - 正确以上限 `slot_right - win_w` 进行 clamp：
    ```rust
    let max_allowed_x = slot_right - win_w;
    let rx = (slot_right - win_w + offset_x_phys).clamp(scan.tray_rect.left + 8, max_allowed_x);
    ```
- **增加物理右边界终极硬防线 (Global Invariant)**：
  - 在最终得出 `target_x_phys` 与 `target_win_w_phys` 后，强制执行：
    ```rust
    let max_safe_right = (scan.tray_rect.right - (12.0 * scale).round() as i32).min(slot_right);
    if target_x_phys + target_win_w_phys > max_safe_right {
        target_x_phys = max_safe_right - target_win_w_phys;
    }
    // 若受托盘挤压导致 x 越过左侧图标，则自动压缩窗口宽度，保证绝不溢出
    if target_x_phys < slot_left {
        target_x_phys = slot_left;
        target_win_w_phys = (max_safe_right - slot_left).max(min_total_w_phys);
    }
    ```

### 步骤 2：调整前端窗口布局与内边距安全余量 (`src/App.tsx` & `src/components/MiniAuraWidget.tsx`)
- **前端宽度计算减除边距**：
  - 在 `src/App.tsx` 中，计算 `effectiveWidth` 时为 Tauri 模式扣减容器内边距与右侧悬浮按钮预留空间：
    ```typescript
    const effectiveWidth = isTauri
      ? taskbarSlot
        ? Math.max(100, Math.min(settings.lineWidth, taskbarSlot.availableWidth - 8))
        : settings.lineWidth
      : Math.min(settings.lineWidth, simMaxWidth);
    ```
- **Tauri 窗口根容器容器对齐与抗裁剪处理**：
  - 确保 Tauri 根容器具备精准的 `box-border`，并将内部 flex 布局设为紧凑无损对齐，确保画布最高频柱体完整显现且不被右边缘裁剪。

### 步骤 3：验证与构建检查
- 执行 `compile_applet` 确保 TypeScript 与前端包构建无错误。
- 确认无论是 Web 模拟预览环境，还是打包成 Windows 桌面端运行环境，右侧频谱都能紧凑呼吸、永不截断。
