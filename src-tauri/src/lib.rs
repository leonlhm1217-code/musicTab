mod audio_loopback;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, Position, Window,
};

static CLICK_THROUGH_ACTIVE: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn set_click_through(window: Window, ignore: bool) -> Result<(), String> {
    CLICK_THROUGH_ACTIVE.store(ignore, Ordering::SeqCst);
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_window_drag(window: Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_window_position(window: Window) -> Result<(i32, i32), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    Ok((pos.x, pos.y))
}

#[tauri::command]
fn set_window_position(window: Window, x: i32, y: i32) -> Result<(), String> {
    window
        .set_position(Position::Physical(PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reset_window_to_bottom_center(window: Window) -> Result<(i32, i32), String> {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen = monitor.size();
        let win_size = window
            .outer_size()
            .unwrap_or(tauri::PhysicalSize { width: 440, height: 84 });
        let x = ((screen.width as i32) - (win_size.width as i32)) / 2;
        let y = (screen.height as i32) - (win_size.height as i32) - 96;
        let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
        return Ok((x, y));
    }
    let _ = window.set_position(Position::Physical(PhysicalPosition { x: 400, y: 820 }));
    Ok((400, 820))
}

/// Generates a crisp 32x32 RGBA tray icon in memory (glowing acoustic line on dark rounded badge)
/// so the Windows System Tray icon always renders cleanly without external file dependencies.
fn build_embedded_tray_icon() -> Image<'static> {
    let width = 32usize;
    let height = 32usize;
    let mut rgba = vec![0u8; width * height * 4];

    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) * 4;
            let dx = (x as f32) - 15.5;
            let dy = (y as f32) - 15.5;
            let dist = (dx * dx + dy * dy).sqrt();

            // Circular dark matte badge
            if dist <= 14.5 {
                rgba[idx] = 18;
                rgba[idx + 1] = 18;
                rgba[idx + 2] = 24;
                rgba[idx + 3] = 245;

                // Acoustic glowing fine line across the center (y around 15..17, x 5..26)
                if (5..=26).contains(&x) && (13..=18).contains(&y) {
                    let norm_x = ((x - 5) as f32) / 21.0;
                    let line_dist = ((y as f32) - 15.5).abs();
                    if line_dist <= 1.6 {
                        // Gradient from cyan-indigo (left) to white core (center) to violet (right)
                        let r = (110.0 + 145.0 * (1.0 - (norm_x - 0.5).abs() * 1.8).max(0.0)) as u8;
                        let g = (195.0 + 60.0 * (1.0 - norm_x)) as u8;
                        let b = 255u8;
                        rgba[idx] = r;
                        rgba[idx + 1] = g;
                        rgba[idx + 2] = b;
                        rgba[idx + 3] = 255;
                    }
                }
            }
        }
    }

    Image::new_owned(rgba, width as u32, height as u32)
}

fn setup_system_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let toggle_controls = MenuItem::with_id(
        app,
        "toggle_controls",
        "显示 / 隐藏底部微调栏 (Alt+H)",
        true,
        None::<&str>,
    )?;
    let toggle_click_through = MenuItem::with_id(
        app,
        "toggle_click_through",
        "开启 / 解除鼠标穿透锁定",
        true,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let theme_white = MenuItem::with_id(
        app,
        "theme_minimal_white",
        "色彩预设：极简白",
        true,
        None::<&str>,
    )?;
    let theme_sea = MenuItem::with_id(
        app,
        "theme_deep_sea",
        "色彩预设：深海静谧",
        true,
        None::<&str>,
    )?;
    let theme_pulse = MenuItem::with_id(
        app,
        "theme_vibrant_pulse",
        "色彩预设：活力律动",
        true,
        None::<&str>,
    )?;
    let theme_forest = MenuItem::with_id(
        app,
        "theme_forest_mist",
        "色彩预设：森屿微光",
        true,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let reset_pos = MenuItem::with_id(
        app,
        "reset_position",
        "重置细线到屏幕底部中央",
        true,
        None::<&str>,
    )?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 AuraLine", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_controls,
            &toggle_click_through,
            &sep1,
            &theme_white,
            &theme_sea,
            &theme_pulse,
            &theme_forest,
            &sep2,
            &reset_pos,
            &sep3,
            &quit_item,
        ],
    )?;

    let icon = build_embedded_tray_icon();

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("AuraLine — 隐身声学细线 (仅监听扬声器/耳机输出，零麦克风占用)")
        .menu(&menu)
        .on_menu_event(|app_handle, event| {
            let id = event.id().as_ref();
            match id {
                "toggle_controls" => {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.set_ignore_cursor_events(false);
                        CLICK_THROUGH_ACTIVE.store(false, Ordering::SeqCst);
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                    let _ = app_handle.emit("tray-command", "toggle-controls");
                }
                "toggle_click_through" => {
                    let next = !CLICK_THROUGH_ACTIVE.load(Ordering::SeqCst);
                    CLICK_THROUGH_ACTIVE.store(next, Ordering::SeqCst);
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.set_ignore_cursor_events(next);
                    }
                    let payload = if next {
                        "set-click-through:true"
                    } else {
                        "set-click-through:false"
                    };
                    let _ = app_handle.emit("tray-command", payload);
                }
                "theme_minimal_white" => {
                    let _ = app_handle.emit("tray-command", "set-theme:minimal_white");
                }
                "theme_deep_sea" => {
                    let _ = app_handle.emit("tray-command", "set-theme:deep_sea");
                }
                "theme_vibrant_pulse" => {
                    let _ = app_handle.emit("tray-command", "set-theme:vibrant_pulse");
                }
                "theme_forest_mist" => {
                    let _ = app_handle.emit("tray-command", "set-theme:forest_mist");
                }
                "reset_position" => {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.set_ignore_cursor_events(false);
                        CLICK_THROUGH_ACTIVE.store(false, Ordering::SeqCst);
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                    let _ = app_handle.emit("tray-command", "reset-position");
                }
                "quit" => {
                    app_handle.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app_handle = tray.app_handle();
                if let Some(win) = app_handle.get_webview_window("main") {
                    let _ = win.set_ignore_cursor_events(false);
                    CLICK_THROUGH_ACTIVE.store(false, Ordering::SeqCst);
                    let _ = win.show();
                    let _ = win.set_focus();
                }
                let _ = app_handle.emit("tray-command", "show-controls");
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            // 1. 初始化右下角 Windows 系统托盘图标与右键控制菜单
            let _ = setup_system_tray(&handle);
            // 2. 启动 100% 纯输出端声卡回环监听 (仅限 default_output_device，物理禁用麦克风)
            audio_loopback::spawn_soundcard_loopback(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            start_window_drag,
            get_window_position,
            set_window_position,
            reset_window_to_bottom_center
        ])
        .run(tauri::generate_context!())
        .expect("AuraLine 原生桌面程序启动失败");
}
