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
    pub fn scan_taskbar_empty_slot(our_win_left: i32, our_win_right: i32) -> Option<TaskbarScanResult> {
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
            let mut notify_left_x = tray_rect.right - 220;
            if notify_hwnd != 0 {
                let mut notify_rect = RECT::default();
                if GetWindowRect(notify_hwnd, &mut notify_rect) != 0
                    && notify_rect.left > tray_rect.left + 200
                {
                    notify_left_x = notify_rect.left;
                }
            }
            let safe_tray_left = (notify_left_x - 38).max(tray_rect.left + 240);

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
            let strip_h = 5;
            let sample_y = tray_rect.top + (tray_h / 2) - 2;

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
            let bmp = CreateCompatibleBitmap(screen_dc, strip_w, strip_h);
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

                let mut pixels = vec![0u8; (strip_w * strip_h * 4) as usize];
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
                    // Sample empty taskbar background reference color from both left-mid and right-hand empty zones
                    let mut bg_r_sum = 0i32;
                    let mut bg_g_sum = 0i32;
                    let mut bg_b_sum = 0i32;
                    let mut bg_cnt = 0i32;

                    let sample_ranges = [
                        (180.min(strip_w), 260.min(strip_w)),
                        ((strip_w - 90).max(0), strip_w),
                    ];

                    for (r_start, r_end) in sample_ranges {
                        for rel_x in r_start..r_end {
                            let abs_x = tray_rect.left + rel_x;
                            if abs_x >= our_win_left - 18 && abs_x <= our_win_right + 18 {
                                continue;
                            }
                            let idx = ((2 * strip_w + rel_x) * 4) as usize;
                            bg_b_sum += pixels[idx] as i32;
                            bg_g_sum += pixels[idx + 1] as i32;
                            bg_r_sum += pixels[idx + 2] as i32;
                            bg_cnt += 1;
                        }
                    }

                    if bg_cnt > 0 {
                        let bg_r = bg_r_sum / bg_cnt;
                        let bg_g = bg_g_sum / bg_cnt;
                        let bg_b = bg_b_sum / bg_cnt;

                        // A. Scan from past the far-left corner/widget zone toward the center
                        // Use a high-contrast threshold (78) so Windows 11 Mica wallpaper gradients never false-trigger
                        let mut left_hits = 0;
                        let mut found_left = None;
                        let scan_left_start = (tray_w * 22 / 100).max(260).min(strip_w / 2);
                        let scan_left_end = (strip_w * 2 / 3).min(strip_w - 20);

                        for rel_x in scan_left_start..scan_left_end {
                            let abs_x = tray_rect.left + rel_x;
                            if abs_x >= our_win_left - 18 && abs_x <= our_win_right + 18 {
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
                                left_hits += 1;
                                if left_hits >= 8 {
                                    found_left = Some(abs_x - 8);
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
                        let mut found_right = None;

                        for rel_x in (120..(strip_w - 8)).rev() {
                            let abs_x = tray_rect.left + rel_x;
                            if abs_x >= our_win_left - 18 && abs_x <= our_win_right + 18 {
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
                                right_hits += 1;
                                if right_hits >= 6 {
                                    found_right = Some(abs_x + 6);
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

        loop {
            if is_first_pass {
                std::thread::sleep(Duration::from_millis(120));
                is_first_pass = false;
            } else {
                std::thread::sleep(Duration::from_millis(800));
            }

            let cfg = match config_state.lock() {
                Ok(g) => g.clone(),
                Err(_) => continue,
            };

            if cfg.dock_mode == "manual" {
                continue;
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

                    let our_left = cur_pos.x;
                    let our_right = cur_pos.x + (cur_size.width as i32);

                    if let Some(scan) = win32_taskbar::scan_taskbar_empty_slot(our_left, our_right) {
                        let tray_h_phys = (scan.tray_rect.bottom - scan.tray_rect.top).max(36);
                        let button_margin_phys = (16.0 * scale).round() as i32;
                        let desired_w_phys = ((cfg.desired_width as f64) * scale).round() as i32;
                        let max_total_w_phys = desired_w_phys + button_margin_phys;
                        let min_total_w_phys = (160.0 * scale).round() as i32;
                        let offset_x_phys = ((cfg.offset_x as f64) * scale).round() as i32;

                        let (target_x_phys, avail_w_phys) = if cfg.dock_mode == "left_edge" {
                            // Stick closely to the far-left edge of the taskbar, avoiding the centered Start/Search bar
                            let left_x = (scan.tray_rect.left + (8.0 * scale).round() as i32 + offset_x_phys)
                                .max(scan.tray_rect.left + 2);
                            let avail = (scan.centered_left_x - (10.0 * scale).round() as i32 - left_x)
                                .max(min_total_w_phys);
                            (left_x, avail)
                        } else if cfg.dock_mode == "before_tray" {
                            let slot_left = scan.icons_right_x + (14.0 * scale).round() as i32;
                            let slot_right = scan.notify_left_x - (8.0 * scale).round() as i32;
                            let avail = (slot_right - slot_left).max(min_total_w_phys);
                            let win_w = avail.min(max_total_w_phys).max(min_total_w_phys);
                            let rx = (slot_right - win_w + offset_x_phys)
                                .clamp(scan.tray_rect.left + 8, (slot_right - min_total_w_phys).max(scan.tray_rect.left + 8));
                            (rx, avail)
                        } else {
                            // "after_icons": Immediately to the right of the last taskbar icon / search box
                            let slot_left = scan.icons_right_x + (14.0 * scale).round() as i32;
                            let slot_right = scan.notify_left_x - (8.0 * scale).round() as i32;
                            let avail = (slot_right - slot_left).max(min_total_w_phys);
                            let rx = (slot_left + offset_x_phys)
                                .clamp(scan.tray_rect.left + 8, (slot_right - min_total_w_phys).max(scan.tray_rect.left + 8));
                            (rx, avail)
                        };

                        let target_win_w_phys = avail_w_phys.min(max_total_w_phys).max(min_total_w_phys);
                        let inner_bar_w_phys = (target_win_w_phys - button_margin_phys).max((140.0 * scale).round() as i32);
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

                        if (target_x_phys - last_applied_x).abs() > 2
                            || (target_y_phys - last_applied_y).abs() > 1
                            || (target_win_w_phys - last_applied_w).abs() > 4
                            || (target_win_h_phys - last_applied_h).abs() > 2
                        {
                            let _ = main_win.set_size(Size::Physical(PhysicalSize {
                                width: target_win_w_phys as u32,
                                height: target_win_h_phys as u32,
                            }));
                            let _ = main_win.set_position(Position::Physical(PhysicalPosition {
                                x: target_x_phys,
                                y: target_y_phys,
                            }));
                            let _ = main_win.set_always_on_top(true);

                            last_applied_x = target_x_phys;
                            last_applied_y = target_y_phys;
                            last_applied_w = target_win_w_phys;
                            last_applied_h = target_win_h_phys;
                        }

                        let payload = TaskbarSlotPayload {
                            x: target_x_phys,
                            y: target_y_phys,
                            available_width: inner_bar_w_logical,
                            taskbar_height: tray_h_logical,
                            recommended_bands,
                            centered_left_x: ((scan.centered_left_x as f64) / scale).round() as i32,
                            icons_right_x: ((scan.icons_right_x as f64) / scale).round() as i32,
                            tray_left_x: ((scan.notify_left_x as f64) / scale).round() as i32,
                        };
                        let _ = app.emit("taskbar-slot-updated", payload);
                    }
                }
            }
        }
    });
}
