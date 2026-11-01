use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskbarSlotPayload {
    pub x: i32,
    pub y: i32,
    pub available_width: i32,
    pub taskbar_height: i32,
    pub recommended_bands: u32,
    pub centered_left_x: i32,
    pub icons_right_x: i32,
    pub tray_left_x: i32,
}

#[derive(Clone)]
pub struct TaskbarAdaptiveConfig {
    pub dock_mode: String, // "left_edge" | "after_icons" | "before_tray" | "manual"
    pub offset_x: i32,
    pub desired_width: i32,
    pub desired_height: i32,
    pub preferred_bands: u32,
}

impl Default for TaskbarAdaptiveConfig {
    fn default() -> Self {
        Self {
            dock_mode: "left_edge".to_string(),
            offset_x: 0,
            desired_width: 320,
            desired_height: 38,
            preferred_bands: 24,
        }
    }
}

#[cfg(target_os = "windows")]
mod win32_taskbar {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr::null;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    pub struct RECT {
        pub left: i32,
        pub top: i32,
        pub right: i32,
        pub bottom: i32,
    }

    #[repr(C)]
    pub struct BITMAPINFOHEADER {
        pub bi_size: u32,
        pub bi_width: i32,
        pub bi_height: i32,
        pub bi_planes: u16,
        pub bi_bit_count: u16,
        pub bi_compression: u32,
        pub bi_size_image: u32,
        pub bi_x_pels_per_meter: i32,
        pub bi_y_pels_per_meter: i32,
        pub bi_clr_used: u32,
        pub bi_clr_important: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(lp_class_name: *const u16, lp_window_name: *const u16) -> isize;
        fn FindWindowExW(
            hwnd_parent: isize,
            hwnd_child_after: isize,
            lpsz_class: *const u16,
            lpsz_window: *const u16,
        ) -> isize;
        fn GetWindowRect(hwnd: isize, lp_rect: *mut RECT) -> i32;
        fn GetDC(hwnd: isize) -> isize;
        fn ReleaseDC(hwnd: isize, hdc: isize) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(hdc: isize) -> isize;
        fn CreateCompatibleBitmap(hdc: isize, cx: i32, cy: i32) -> isize;
        fn SelectObject(hdc: isize, h: isize) -> isize;
        fn BitBlt(
            hdc: isize,
            x: i32,
            y: i32,
            cx: i32,
            cy: i32,
            hdc_src: isize,
            x1: i32,
            y1: i32,
            rop: u32,
        ) -> i32;
        fn GetDIBits(
            hdc: isize,
            hbm: isize,
            start: u32,
            c_lines: u32,
            lpv_bits: *mut u8,
            lpbmi: *mut BITMAPINFOHEADER,
            usage: u32,
        ) -> i32;
        fn DeleteObject(ho: isize) -> i32;
        fn DeleteDC(hdc: isize) -> i32;
    }

    const SRCCOPY: u32 = 0x00CC0020;
    const DIB_RGB_COLORS: u32 = 0;

    fn to_wide(s: &str) -> Vec<u16> {
        OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }

    pub struct TaskbarScanResult {
        pub tray_rect: RECT,
        pub centered_left_x: i32,
        pub icons_right_x: i32,
        pub notify_left_x: i32,
    }

    /// Detects the Windows 10/11 Taskbar (`Shell_TrayWnd`), the right-side System Tray (`TrayNotifyWnd`),
    /// and scans the taskbar pixel strip (excluding our own window rect) to find:
    /// 1. `centered_left_x`: the left boundary of the centered Start button / Search box / app icons
    ///    (so when docked at the far-left edge `left_edge`, it never overlaps the centered items).
    /// 2. `icons_right_x`: the right boundary of the last taskbar icon / search box.
    pub fn scan_taskbar_empty_slot(
        our_win_left: i32,
        our_win_right: i32,
        scale: f64,
        pixels: &mut Vec<u8>,
    ) -> Option<TaskbarScanResult> {
        unsafe {
            let tray_class = to_wide("Shell_TrayWnd");
            let tray_hwnd = FindWindowW(tray_class.as_ptr(), null());
            if tray_hwnd == 0 {
                return None;
            }

            let mut tray_rect = RECT::default();
            if GetWindowRect(tray_hwnd, &mut tray_rect) == 0 {
                return None;
            }

            let tray_w = tray_rect.right - tray_rect.left;
            let tray_h = tray_rect.bottom - tray_rect.top;
            if tray_w < 400 || tray_h < 24 || tray_h > 160 {
                return None;
            }

            // Locate TrayNotifyWnd (right-hand system tray clock & icons)
            let notify_class = to_wide("TrayNotifyWnd");
            let notify_hwnd = FindWindowExW(tray_hwnd, 0, notify_class.as_ptr(), null());
            let min_tray_reserve = ((280.0 * scale).round() as i32).max(280);
            let mut notify_left_x = tray_rect.right - min_tray_reserve;
            if notify_hwnd != 0 {
                let mut notify_rect = RECT::default();
                if GetWindowRect(notify_hwnd, &mut notify_rect) != 0
                    && notify_rect.left > tray_rect.left + 200
                {
                    // Ensure notify_left_x does not intrude into the clock / action center reserve
                    notify_left_x = notify_rect.left.min(tray_rect.right - min_tray_reserve);
                }
            }
            let safe_tray_left = (notify_left_x - (16.0 * scale).round() as i32).max(tray_rect.left + 240);

            let rebar_class = to_wide("ReBarWindow32");
            let rebar_hwnd = FindWindowExW(tray_hwnd, 0, rebar_class.as_ptr(), null());
            let mut min_icons_left = tray_rect.left + 120;
            if rebar_hwnd != 0 {
                let mut rebar_rect = RECT::default();
                if GetWindowRect(rebar_hwnd, &mut rebar_rect) != 0 && rebar_rect.left > tray_rect.left {
                    min_icons_left = rebar_rect.left;
                }
            }

            let strip_w = (safe_tray_left - tray_rect.left).clamp(200, 5120);
            let strip_h = 3;
            let sample_y = tray_rect.top + (tray_h / 2) - 1;

            let default_centered_left = tray_rect.left + (tray_w * 35 / 100).max(420);

            let screen_dc = GetDC(0);
            if screen_dc == 0 {
                return Some(TaskbarScanResult {
                    tray_rect,
                    centered_left_x: default_centered_left,
                    icons_right_x: min_icons_left + 260,
                    notify_left_x: safe_tray_left,
                });
            }

            let mem_dc = CreateCompatibleDC(screen_dc);
            if mem_dc == 0 {
                ReleaseDC(0, screen_dc);
                return Some(TaskbarScanResult {
                    tray_rect,
                    centered_left_x: default_centered_left,
                    icons_right_x: min_icons_left + 260,
                    notify_left_x: safe_tray_left,
                });
            }

            let bmp = CreateCompatibleBitmap(screen_dc, strip_w, strip_h);
            if bmp == 0 {
                DeleteDC(mem_dc);
                ReleaseDC(0, screen_dc);
                return Some(TaskbarScanResult {
                    tray_rect,
                    centered_left_x: default_centered_left,
                    icons_right_x: min_icons_left + 260,
                    notify_left_x: safe_tray_left,
                });
            }

            let old_obj = SelectObject(mem_dc, bmp);

            let blt_ok = BitBlt(
                mem_dc,
                0,
                0,
                strip_w,
                strip_h,
                screen_dc,
                tray_rect.left,
                sample_y,
                SRCCOPY,
            );

            let mut detected_centered_left = default_centered_left;
            let mut detected_icons_right = min_icons_left + 240;

            if blt_ok != 0 {
                let mut bmi = BITMAPINFOHEADER {
                    bi_size: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    bi_width: strip_w,
                    bi_height: -strip_h,
                    bi_planes: 1,
                    bi_bit_count: 32,
                    bi_compression: 0,
                    bi_size_image: (strip_w * strip_h * 4) as u32,
                    bi_x_pels_per_meter: 0,
                    bi_y_pels_per_meter: 0,
                    bi_clr_used: 0,
                    bi_clr_important: 0,
                };

                let req_len = (strip_w * strip_h * 4) as usize;
                if pixels.len() < req_len {
                    pixels.resize(req_len, 0);
                }
                let lines = GetDIBits(
                    mem_dc,
                    bmp,
                    0,
                    strip_h as u32,
                    pixels.as_mut_ptr(),
                    &mut bmi,
                    DIB_RGB_COLORS,
                );

                if lines > 0 {
                    // Sample empty taskbar background reference color from flat (low vertical variance) columns
                    // strictly outside our window region
                    let mut bg_r_sum = 0i32;
                    let mut bg_g_sum = 0i32;
                    let mut bg_b_sum = 0i32;
                    let mut bg_cnt = 0i32;

                    // Tight exclusion margin around our frameless window so we never swallow adjacent taskbar icons
                    let win_exclude_margin = ((3.0 * scale).round() as i32).max(3);
                    // Larger safety margin when sampling pure taskbar background color
                    let bg_exclude_margin = ((20.0 * scale).round() as i32).max(20);
                    let sample_ranges = [
                        (160.min(strip_w), 260.min(strip_w)),
                        ((strip_w - 110).max(0), (strip_w - 20).max(0)),
                    ];

                    for (r_start, r_end) in sample_ranges {
                        for rel_x in r_start..r_end {
                            let abs_x = tray_rect.left + rel_x;
                            if abs_x >= our_win_left - bg_exclude_margin
                                && abs_x <= our_win_right + bg_exclude_margin
                            {
                                continue;
                            }
                            // Only include columns with flat vertical color (pure background, not an icon)
                            let base_idx = ((1 * strip_w + rel_x) * 4) as usize;
                            let b0 = pixels[base_idx] as i32;
                            let g0 = pixels[base_idx + 1] as i32;
                            let r0 = pixels[base_idx + 2] as i32;
                            let mut max_v_diff = 0i32;
                            for row in 0..strip_h {
                                let idx = ((row * strip_w + rel_x) * 4) as usize;
                                let vd = (pixels[idx] as i32 - b0).abs()
                                    + (pixels[idx + 1] as i32 - g0).abs()
                                    + (pixels[idx + 2] as i32 - r0).abs();
                                if vd > max_v_diff {
                                    max_v_diff = vd;
                                }
                            }
                            if max_v_diff <= 18 {
                                bg_b_sum += b0;
                                bg_g_sum += g0;
                                bg_r_sum += r0;
                                bg_cnt += 1;
                            }
                        }
                    }

                    if bg_cnt > 0 {
                        let bg_r = bg_r_sum / bg_cnt;
                        let bg_g = bg_g_sum / bg_cnt;
                        let bg_b = bg_b_sum / bg_cnt;

                        // A. Scan from past the far-left corner/widget zone toward the center
                        // Use a high-contrast threshold (78) so Windows 11 Mica wallpaper gradients never false-trigger
                        let mut left_hits = 0;
                        let mut left_first_hit_x = 0i32;
                        let mut found_left = None;
                        let scan_left_start = (tray_w * 22 / 100).max(260).min(strip_w / 2);
                        let scan_left_end = (strip_w * 2 / 3).min(strip_w - 20);

                        for rel_x in scan_left_start..scan_left_end {
                            let abs_x = tray_rect.left + rel_x;
                            if abs_x >= our_win_left - win_exclude_margin
                                && abs_x <= our_win_right + win_exclude_margin
                            {
                                left_hits = 0;
                                continue;
                            }

                            let mut col_diff_max = 0i32;
                            for row in 0..strip_h {
                                let idx = ((row * strip_w + rel_x) * 4) as usize;
                                let b = pixels[idx] as i32;
                                let g = pixels[idx + 1] as i32;
                                let r = pixels[idx + 2] as i32;
                                let diff = (r - bg_r).abs() + (g - bg_g).abs() + (b - bg_b).abs();
                                if diff > col_diff_max {
                                    col_diff_max = diff;
                                }
                            }

                            if col_diff_max > 78 {
                                if left_hits == 0 {
                                    left_first_hit_x = abs_x;
                                }
                                left_hits += 1;
                                if left_hits >= 8 {
                                    found_left = Some(left_first_hit_x);
                                    break;
                                }
                            } else {
                                left_hits = 0;
                            }
                        }

                        if let Some(lx) = found_left {
                            detected_centered_left = lx;
                        }

                        // B. Scan from right to left to find the rightmost icon / search box edge
                        let mut right_hits = 0;
                        let mut right_first_hit_x = 0i32;
                        let mut found_right = None;

                        for rel_x in (120..(strip_w - 8)).rev() {
                            let abs_x = tray_rect.left + rel_x;
                            if abs_x >= our_win_left - win_exclude_margin
                                && abs_x <= our_win_right + win_exclude_margin
                            {
                                right_hits = 0;
                                continue;
                            }

                            let mut col_diff_max = 0i32;
                            for row in 0..strip_h {
                                let idx = ((row * strip_w + rel_x) * 4) as usize;
                                let b = pixels[idx] as i32;
                                let g = pixels[idx + 1] as i32;
                                let r = pixels[idx + 2] as i32;
                                let diff = (r - bg_r).abs() + (g - bg_g).abs() + (b - bg_b).abs();
                                if diff > col_diff_max {
                                    col_diff_max = diff;
                                }
                            }

                            if col_diff_max > 72 {
                                if right_hits == 0 {
                                    right_first_hit_x = abs_x;
                                }
                                right_hits += 1;
                                if right_hits >= 6 {
                                    found_right = Some(right_first_hit_x);
                                    break;
                                }
                            } else {
                                right_hits = 0;
                            }
                        }

                        if let Some(rx) = found_right {
                            detected_icons_right = rx;
                        }
                    }
                }
            }

            SelectObject(mem_dc, old_obj);
            DeleteObject(bmp);
            DeleteDC(mem_dc);
            ReleaseDC(0, screen_dc);

            Some(TaskbarScanResult {
                tray_rect,
                centered_left_x: detected_centered_left,
                icons_right_x: detected_icons_right,
                notify_left_x: safe_tray_left,
            })
        }
    }
}

pub fn spawn_taskbar_adaptive_watcher(
    app: AppHandle,
    config_state: Arc<Mutex<TaskbarAdaptiveConfig>>,
) {
    std::thread::spawn(move || {
        let mut last_applied_x = -99999i32;
        let mut last_applied_y = -99999i32;
        let mut last_applied_w = -99999i32;
        let mut last_applied_h = -99999i32;
        let mut is_first_pass = true;

        // Reusable pixel buffer to avoid heap allocations on each taskbar scan
        #[cfg(target_os = "windows")]
        let mut shared_pixel_buf: Vec<u8> = Vec::with_capacity(2560 * 3 * 4);

        // Hysteresis and multi-frame confirmation state to prevent limit-cycle jitter
        let mut stable_icons_right_x: Option<i32> = None;
        let mut pending_icons_right_x: Option<i32> = None;
        let mut pending_icons_count: u8 = 0;

        let mut stable_centered_left_x: Option<i32> = None;
        let mut pending_centered_left_x: Option<i32> = None;
        let mut pending_centered_count: u8 = 0;

        let mut last_cfg_dock_mode = String::new();
        let mut last_cfg_desired_w = -1i32;
        let mut last_cfg_offset_x = -99999i32;
        let mut last_cfg_bands = 0u32;

        // Track last emitted telemetry to avoid redundant IPC broadcasts
        let mut last_emitted_x = -99999i32;
        let mut last_emitted_y = -99999i32;
        let mut last_emitted_avail_w = -99999i32;
        let mut last_emitted_bands = 0u32;

        loop {
            if is_first_pass {
                std::thread::sleep(Duration::from_millis(120));
                is_first_pass = false;
            } else {
                // Sleep 4000ms (16 x 250ms) when steady-state locked, or 2000ms (8 x 250ms) when settling,
                // while waking within 250ms if user changes taskbar config
                let is_steady = stable_icons_right_x.is_some()
                    && pending_icons_count == 0
                    && pending_centered_count == 0;
                let sleep_slices = if is_steady { 16 } else { 8 };
                for _ in 0..sleep_slices {
                    std::thread::sleep(Duration::from_millis(250));
                    if let Ok(g) = config_state.lock() {
                        if g.dock_mode != last_cfg_dock_mode
                            || g.desired_width != last_cfg_desired_w
                            || g.offset_x != last_cfg_offset_x
                            || g.preferred_bands != last_cfg_bands
                        {
                            break;
                        }
                    }
                }
            }

            let cfg = match config_state.lock() {
                Ok(g) => g.clone(),
                Err(_) => continue,
            };

            if cfg.dock_mode == "manual" {
                last_applied_x = -99999;
                last_applied_y = -99999;
                last_applied_w = -99999;
                last_applied_h = -99999;
                stable_icons_right_x = None;
                stable_centered_left_x = None;
                last_cfg_dock_mode = cfg.dock_mode.clone();
                continue;
            }

            let cfg_changed = cfg.dock_mode != last_cfg_dock_mode
                || cfg.desired_width != last_cfg_desired_w
                || cfg.offset_x != last_cfg_offset_x
                || cfg.preferred_bands != last_cfg_bands;
            if cfg_changed {
                last_cfg_dock_mode = cfg.dock_mode.clone();
                last_cfg_desired_w = cfg.desired_width;
                last_cfg_offset_x = cfg.offset_x;
                last_cfg_bands = cfg.preferred_bands;
            }

            #[cfg(target_os = "windows")]
            {
                if let Some(main_win) = app.get_webview_window("main") {
                    let scale = main_win.scale_factor().unwrap_or(1.0).max(1.0);
                    let cur_pos = main_win
                        .outer_position()
                        .unwrap_or(PhysicalPosition { x: -1000, y: -1000 });
                    let cur_size = main_win
                        .outer_size()
                        .unwrap_or(PhysicalSize { width: 360, height: 44 });

                    // Only exclude our current window rectangle if it has already been placed by the adaptive watcher
                    let (our_left, our_right) = if last_applied_x > -90000 {
                        (cur_pos.x, cur_pos.x + (cur_size.width as i32))
                    } else {
                        (-10000, -9900)
                    };

                    if let Some(scan) = win32_taskbar::scan_taskbar_empty_slot(
                        our_left,
                        our_right,
                        scale,
                        &mut shared_pixel_buf,
                    ) {
                        let deadband_phys = ((12.0 * scale).round() as i32).max(12);

                        // Stabilize icons_right_x with deadband + 2-frame debounce
                        let effective_icons_right_x = match stable_icons_right_x {
                            None => {
                                stable_icons_right_x = Some(scan.icons_right_x);
                                pending_icons_right_x = None;
                                pending_icons_count = 0;
                                scan.icons_right_x
                            }
                            Some(stable_rx) => {
                                if (scan.icons_right_x - stable_rx).abs() <= deadband_phys {
                                    pending_icons_right_x = None;
                                    pending_icons_count = 0;
                                    stable_rx
                                } else {
                                    let matches_pending = pending_icons_right_x
                                        .map(|prx| (scan.icons_right_x - prx).abs() <= deadband_phys)
                                        .unwrap_or(false);
                                    if matches_pending {
                                        pending_icons_count = pending_icons_count.saturating_add(1);
                                        if pending_icons_count >= 2 {
                                            stable_icons_right_x = Some(scan.icons_right_x);
                                            pending_icons_right_x = None;
                                            pending_icons_count = 0;
                                            scan.icons_right_x
                                        } else {
                                            stable_rx
                                        }
                                    } else {
                                        pending_icons_right_x = Some(scan.icons_right_x);
                                        pending_icons_count = 1;
                                        stable_rx
                                    }
                                }
                            }
                        };

                        // Stabilize centered_left_x with deadband + 2-frame debounce
                        let effective_centered_left_x = match stable_centered_left_x {
                            None => {
                                stable_centered_left_x = Some(scan.centered_left_x);
                                pending_centered_left_x = None;
                                pending_centered_count = 0;
                                scan.centered_left_x
                            }
                            Some(stable_lx) => {
                                if (scan.centered_left_x - stable_lx).abs() <= deadband_phys {
                                    pending_centered_left_x = None;
                                    pending_centered_count = 0;
                                    stable_lx
                                } else {
                                    let matches_pending = pending_centered_left_x
                                        .map(|plx| (scan.centered_left_x - plx).abs() <= deadband_phys)
                                        .unwrap_or(false);
                                    if matches_pending {
                                        pending_centered_count = pending_centered_count.saturating_add(1);
                                        if pending_centered_count >= 2 {
                                            stable_centered_left_x = Some(scan.centered_left_x);
                                            pending_centered_left_x = None;
                                            pending_centered_count = 0;
                                            scan.centered_left_x
                                        } else {
                                            stable_lx
                                        }
                                    } else {
                                        pending_centered_left_x = Some(scan.centered_left_x);
                                        pending_centered_count = 1;
                                        stable_lx
                                    }
                                }
                            }
                        };

                        let tray_h_phys = (scan.tray_rect.bottom - scan.tray_rect.top).max(36);
                        let button_margin_phys = (16.0 * scale).round() as i32;
                        let desired_w_phys = ((cfg.desired_width as f64) * scale).round() as i32;
                        let max_total_w_phys = desired_w_phys + button_margin_phys;
                        let min_total_w_phys = (160.0 * scale).round() as i32;
                        let offset_x_phys = ((cfg.offset_x as f64) * scale).round() as i32;

                        let max_safe_right_phys = (scan.tray_rect.right - (12.0 * scale).round() as i32)
                            .min(scan.notify_left_x - (8.0 * scale).round() as i32);
                        let min_safe_left_phys = scan.tray_rect.left + (4.0 * scale).round() as i32;
                        let icon_gap_phys = ((14.0 * scale).round() as i32).max(14);

                        let (target_x_phys, target_win_w_phys) = if cfg.dock_mode == "left_edge" {
                            // Stick closely to the far-left edge of the taskbar, avoiding the centered Start/Search bar
                            let left_x = (scan.tray_rect.left + (8.0 * scale).round() as i32 + offset_x_phys)
                                .max(min_safe_left_phys);
                            let avail = (effective_centered_left_x - (10.0 * scale).round() as i32 - left_x)
                                .max(min_total_w_phys);
                            let win_w = avail.min(max_total_w_phys).max(min_total_w_phys);
                            (left_x, win_w)
                        } else if cfg.dock_mode == "before_tray" {
                            let slot_left = (effective_icons_right_x + icon_gap_phys).max(min_safe_left_phys);
                            let slot_right = max_safe_right_phys;
                            let anchored_right = (slot_right + offset_x_phys)
                                .clamp(min_safe_left_phys + min_total_w_phys, slot_right);
                            let avail_span = anchored_right - slot_left;
                            let final_w = if avail_span >= max_total_w_phys {
                                max_total_w_phys
                            } else if avail_span >= min_total_w_phys {
                                // Quantize constrained width to 4px steps for extra stability
                                ((avail_span / 4) * 4).max(min_total_w_phys)
                            } else {
                                min_total_w_phys
                            };
                            let rx = (anchored_right - final_w).max(min_safe_left_phys);
                            (rx, final_w)
                        } else {
                            // "after_icons": Immediately to the right of the last taskbar icon / search box
                            let slot_left = (effective_icons_right_x + icon_gap_phys).max(min_safe_left_phys);
                            let slot_right = max_safe_right_phys;
                            let avail_span = slot_right - slot_left;
                            let final_w = if avail_span >= max_total_w_phys {
                                max_total_w_phys
                            } else if avail_span >= min_total_w_phys {
                                ((avail_span / 4) * 4).max(min_total_w_phys)
                            } else {
                                min_total_w_phys
                            };
                            let max_allowed_x = (slot_right - final_w).max(min_safe_left_phys);
                            let min_allowed_x = slot_left.min(max_allowed_x);
                            let rx = (slot_left + offset_x_phys).clamp(min_allowed_x, max_allowed_x);
                            (rx, final_w)
                        };

                        // Universal safety clamp: right edge cannot overflow max_safe_right_phys
                        let mut final_x_phys = target_x_phys;
                        let mut final_w_phys = target_win_w_phys;

                        if final_x_phys + final_w_phys > max_safe_right_phys {
                            final_x_phys = max_safe_right_phys - final_w_phys;
                            if final_x_phys < min_safe_left_phys {
                                final_x_phys = min_safe_left_phys;
                                final_w_phys = (max_safe_right_phys - min_safe_left_phys).max(min_total_w_phys);
                            }
                        }
                        if final_x_phys < min_safe_left_phys {
                            final_x_phys = min_safe_left_phys;
                        }

                        let inner_bar_w_phys = (final_w_phys - button_margin_phys).max((120.0 * scale).round() as i32);
                        let inner_bar_w_logical = ((inner_bar_w_phys as f64) / scale).round() as i32;
                        let tray_h_logical = ((tray_h_phys as f64) / scale).round() as i32;

                        // Dynamically adapt frequency band count based on logical pixel width
                        let recommended_bands = if inner_bar_w_logical >= 200 {
                            cfg.preferred_bands.min(32)
                        } else if inner_bar_w_logical >= 150 {
                            cfg.preferred_bands.min(24)
                        } else {
                            16
                        };

                        // Match full physical height of the Windows taskbar (respecting High-DPI scaling)
                        let target_win_h_phys = (tray_h_phys - (2.0 * scale).round() as i32)
                            .max((36.0 * scale).round() as i32);
                        let target_y_phys = scan.tray_rect.top + (tray_h_phys - target_win_h_phys) / 2;

                        // Use a 4px tolerance on cur_pos/cur_size so WebView2 DPI rounding never triggers a re-apply loop
                        let pos_drifted = (final_x_phys - cur_pos.x).abs() > 4
                            || (target_y_phys - cur_pos.y).abs() > 2
                            || (final_w_phys - (cur_size.width as i32)).abs() > 4
                            || (target_win_h_phys - (cur_size.height as i32)).abs() > 2;

                        let target_changed = cfg_changed
                            || (final_x_phys - last_applied_x).abs() > 2
                            || (target_y_phys - last_applied_y).abs() > 1
                            || (final_w_phys - last_applied_w).abs() > 4
                            || (target_win_h_phys - last_applied_h).abs() > 2;

                        if pos_drifted || target_changed {
                            let _ = main_win.set_size(Size::Physical(PhysicalSize {
                                width: final_w_phys as u32,
                                height: target_win_h_phys as u32,
                            }));
                            let _ = main_win.set_position(Position::Physical(PhysicalPosition {
                                x: final_x_phys,
                                y: target_y_phys,
                            }));
                            let _ = main_win.set_always_on_top(true);

                            last_applied_x = final_x_phys;
                            last_applied_y = target_y_phys;
                            last_applied_w = final_w_phys;
                            last_applied_h = target_win_h_phys;
                        }

                        let should_emit = cfg_changed
                            || (final_x_phys - last_emitted_x).abs() >= 2
                            || (target_y_phys - last_emitted_y).abs() >= 2
                            || (inner_bar_w_logical - last_emitted_avail_w).abs() >= 2
                            || recommended_bands != last_emitted_bands;

                        if should_emit {
                            last_emitted_x = final_x_phys;
                            last_emitted_y = target_y_phys;
                            last_emitted_avail_w = inner_bar_w_logical;
                            last_emitted_bands = recommended_bands;

                            let payload = TaskbarSlotPayload {
                                x: final_x_phys,
                                y: target_y_phys,
                                available_width: inner_bar_w_logical,
                                taskbar_height: tray_h_logical,
                                recommended_bands,
                                centered_left_x: ((effective_centered_left_x as f64) / scale).round() as i32,
                                icons_right_x: ((effective_icons_right_x as f64) / scale).round() as i32,
                                tray_left_x: ((scan.notify_left_x as f64) / scale).round() as i32,
                            };
                            let _ = app.emit("taskbar-slot-updated", payload);
                        }
                    }
                }
            }
        }
    });
}
