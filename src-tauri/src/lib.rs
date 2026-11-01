mod audio_loopback;
mod taskbar_layout;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use taskbar_layout::TaskbarAdaptiveConfig;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, State, WebviewUrl,
    WebviewWindowBuilder,
};

const SINGLE_INSTANCE_ADDR: &str = "127.0.0.1:49172";
static CLICK_THROUGH_ACTIVE: AtomicBool = AtomicBool::new(false);
static SETTINGS_WINDOW_CREATING: AtomicBool = AtomicBool::new(false);

fn acquire_single_instance_lock() -> Option<TcpListener> {
    match TcpListener::bind(SINGLE_INSTANCE_ADDR) {
        Ok(listener) => Some(listener),
        Err(_) => {
            if let Ok(mut stream) = TcpStream::connect(SINGLE_INSTANCE_ADDR) {
                let _ = stream.write_all(b"OPEN_SETTINGS");
            }
            None
        }
    }
}

fn spawn_single_instance_wakeup_listener(listener: TcpListener, app: AppHandle) {
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let mut s = stream;
            let mut buf = [0u8; 32];
            let _ = s.read(&mut buf);
            open_or_focus_settings_window(&app);
        }
    });
}

#[cfg(target_os = "windows")]
fn query_windows_auto_start() -> bool {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    std::process::Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "AuraLine",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(target_os = "windows"))]
fn query_windows_auto_start() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn configure_windows_auto_start(enabled: bool) -> Result<bool, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    if enabled {
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let quoted = format!("\"{}\"", exe_path.to_string_lossy());
        let out = std::process::Command::new("reg")
            .args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "AuraLine",
                "/t",
                "REG_SZ",
                "/d",
                &quoted,
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(true)
        } else {
            Err("注册表写入开机自启失败".to_string())
        }
    } else {
        let _ = std::process::Command::new("reg")
            .args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "AuraLine",
                "/f",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        Ok(false)
    }
}

#[cfg(not(target_os = "windows"))]
fn configure_windows_auto_start(enabled: bool) -> Result<bool, String> {
    Ok(enabled)
}

#[tauri::command]
fn get_auto_start_enabled() -> bool {
    query_windows_auto_start()
}

#[tauri::command]
fn set_auto_start_enabled(enabled: bool) -> Result<bool, String> {
    configure_windows_auto_start(enabled)
}

#[tauri::command]
fn get_click_through_enabled() -> bool {
    CLICK_THROUGH_ACTIVE.load(Ordering::SeqCst)
}

#[tauri::command]
fn update_taskbar_config(
    state: State<'_, Arc<Mutex<TaskbarAdaptiveConfig>>>,
    dock_mode: String,
    offset_x: i32,
    desired_width: i32,
    desired_height: i32,
    preferred_bands: u32,
) -> Result<(), String> {
    if let Ok(mut guard) = state.lock() {
        guard.dock_mode = dock_mode;
        guard.offset_x = offset_x;
        guard.desired_width = desired_width;
        guard.desired_height = desired_height;
        guard.preferred_bands = preferred_bands;
    }
    Ok(())
}

#[tauri::command]
fn set_click_through(app: AppHandle, ignore: bool) -> Result<(), String> {
    CLICK_THROUGH_ACTIVE.store(ignore, Ordering::SeqCst);
    if let Some(main_win) = app.get_webview_window("main") {
        main_win
            .set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    let payload = if ignore {
        "set-click-through:true"
    } else {
        "set-click-through:false"
    };
    let _ = app.emit("tray-command", payload);
    Ok(())
}

#[tauri::command]
fn start_window_drag(app: AppHandle) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        main_win.start_dragging().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_window_position(app: AppHandle) -> Result<(i32, i32), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        let pos = main_win.outer_position().map_err(|e| e.to_string())?;
        return Ok((pos.x, pos.y));
    }
    Ok((8, 1040))
}

#[tauri::command]
fn set_window_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        main_win
            .set_position(Position::Physical(PhysicalPosition { x, y }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn resize_main_bar_window(app: AppHandle, line_width: f64, line_height: f64) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        let target_w = (line_width + 36.0).max(160.0);
        let target_h = (line_height + 8.0).max(36.0);
        let _ = main_win.set_size(Size::Logical(LogicalSize {
            width: target_w,
            height: target_h,
        }));
    }
    Ok(())
}

#[tauri::command]
fn broadcast_settings(app: AppHandle, settings_json: String) -> Result<(), String> {
    let _ = app.emit("settings-updated", settings_json);
    Ok(())
}

#[tauri::command]
async fn open_settings_window(app: AppHandle) -> Result<(), String> {
    open_or_focus_settings_window(&app);
    Ok(())
}

#[tauri::command]
async fn close_settings_window(app: AppHandle) -> Result<(), String> {
    if let Some(settings_win) = app.get_webview_window("settings") {
        if settings_win.destroy().is_err() {
            let _ = settings_win.close();
        }
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn reset_window_to_bottom_center(app: AppHandle) -> Result<(i32, i32), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main_win.current_monitor() {
            let screen = monitor.size();
            let win_size = main_win
                .outer_size()
                .unwrap_or(tauri::PhysicalSize { width: 360, height: 44 });
            let x = 8;
            let y = (screen.height as i32) - (win_size.height as i32) - 4;
            let _ = main_win.set_position(Position::Physical(PhysicalPosition { x, y }));
            return Ok((x, y));
        }
        let _ = main_win.set_position(Position::Physical(PhysicalPosition { x: 8, y: 1040 }));
    }
    Ok((8, 1040))
}

fn open_or_focus_settings_window(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return;
    }

    if SETTINGS_WINDOW_CREATING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    let app_clone = app.clone();
    std::thread::spawn(move || {
        let build_res = WebviewWindowBuilder::new(
            &app_clone,
            "settings",
            WebviewUrl::App("index.html#settings".into()),
        )
        .initialization_script(
            "window.__AURALINE_WINDOW_LABEL__ = 'settings'; window.location.hash = '#settings';",
        )
        .title("AuraLine — 任务栏车载频谱设置")
        .inner_size(500.0, 700.0)
        .min_inner_size(440.0, 540.0)
        .resizable(true)
        .decorations(true)
        .transparent(false)
        .center()
        .build();

        SETTINGS_WINDOW_CREATING.store(false, Ordering::SeqCst);

        if let Ok(win) = build_res {
            let _ = win.show();
            let _ = win.set_focus();
        }
    });
}

/// Generates a 32x32 RGBA car stereo equalizer spectrum icon in memory for the Windows System Tray.
fn build_embedded_tray_icon() -> Image<'static> {
    let width = 32usize;
    let height = 32usize;
    let mut rgba = vec![0u8; width * height * 4];
    let bar_heights = [3usize, 6, 4, 7, 5, 3];

    for y in 0..height {
        for x in 0..width {
            let idx = (y * width + x) * 4;
            let dx = (x as f32) - 15.5;
            let dy = (y as f32) - 15.5;
            let dist = (dx * dx + dy * dy).sqrt();

            if dist <= 14.5 {
                rgba[idx] = 14;
                rgba[idx + 1] = 16;
                rgba[idx + 2] = 22;
                rgba[idx + 3] = 245;

                // Draw 6 miniature segmented VFD bars inside the circular tray badge
                if (4..=27).contains(&x) && (7..=24).contains(&y) {
                    let rel_x = x - 4;
                    let bar_idx = rel_x / 4;
                    let in_bar_col = (rel_x % 4) < 3;
                    if bar_idx < 6 && in_bar_col {
                        let seg_from_bottom = (24 - y) / 2;
                        let is_seg_row = ((24 - y) % 2) == 0;
                        let max_seg = bar_heights[bar_idx];
                        if is_seg_row && seg_from_bottom <= max_seg {
                            if seg_from_bottom == max_seg {
                                // Peak-Hold Red/Coral Cap
                                rgba[idx] = 244;
                                rgba[idx + 1] = 63;
                                rgba[idx + 2] = 94;
                                rgba[idx + 3] = 255;
                            } else if seg_from_bottom >= 5 {
                                // Amber Mid
                                rgba[idx] = 251;
                                rgba[idx + 1] = 191;
                                rgba[idx + 2] = 36;
                                rgba[idx + 3] = 255;
                            } else {
                                // Classic VFD Ice Cyan
                                rgba[idx] = 0;
                                rgba[idx + 1] = 245;
                                rgba[idx + 2] = 212;
                                rgba[idx + 3] = 255;
                            }
                        }
                    }
                }
            }
        }
    }

    Image::new_owned(rgba, width as u32, height as u32)
}

fn setup_system_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let open_settings = MenuItem::with_id(
        app,
        "open_settings",
        "打开任务栏频谱设置...",
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
    let toggle_auto_start = MenuItem::with_id(
        app,
        "toggle_auto_start",
        "开启 / 关闭开机自动启动",
        true,
        None::<&str>,
    )?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let theme_white = MenuItem::with_id(
        app,
        "theme_minimal_white",
        "预设：经典车载 VFD (冰青+琥珀+红顶)",
        true,
        None::<&str>,
    )?;
    let theme_sea = MenuItem::with_id(
        app,
        "theme_deep_sea",
        "预设：深海静谧 (靛蓝+电青+紫顶)",
        true,
        None::<&str>,
    )?;
    let theme_pulse = MenuItem::with_id(
        app,
        "theme_vibrant_pulse",
        "预设：复古琥珀 (暖橙+烈焰红+白顶)",
        true,
        None::<&str>,
    )?;
    let theme_forest = MenuItem::with_id(
        app,
        "theme_forest_mist",
        "预设：极简纯白 (银灰+纯白顶)",
        true,
        None::<&str>,
    )?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let reset_pos = MenuItem::with_id(
        app,
        "reset_position",
        "重新对齐任务栏空白区",
        true,
        None::<&str>,
    )?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 AuraLine", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &open_settings,
            &toggle_click_through,
            &toggle_auto_start,
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
        .tooltip("AuraLine — 任务栏车载 VFD 频谱仪 (左键打开设置 / 右键菜单)")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| {
            let id = event.id().as_ref();
            match id {
                "open_settings" => {
                    open_or_focus_settings_window(app_handle);
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
                "toggle_auto_start" => {
                    let current = query_windows_auto_start();
                    if let Ok(next_state) = configure_windows_auto_start(!current) {
                        let payload = if next_state {
                            "auto-start-changed:true"
                        } else {
                            "auto-start-changed:false"
                        };
                        let _ = app_handle.emit("tray-command", payload);
                    }
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
                open_or_focus_settings_window(app_handle);
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let Some(instance_listener) = acquire_single_instance_lock() else {
        std::process::exit(0);
    };

    let taskbar_cfg = Arc::new(Mutex::new(TaskbarAdaptiveConfig::default()));
    let taskbar_cfg_for_setup = taskbar_cfg.clone();

    tauri::Builder::default()
        .manage(taskbar_cfg)
        .setup(move |app| {
            let handle = app.handle().clone();
            spawn_single_instance_wakeup_listener(instance_listener, handle.clone());
            let _ = setup_system_tray(&handle);
            audio_loopback::spawn_soundcard_loopback(handle.clone());
            taskbar_layout::spawn_taskbar_adaptive_watcher(handle, taskbar_cfg_for_setup);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auto_start_enabled,
            set_auto_start_enabled,
            get_click_through_enabled,
            update_taskbar_config,
            set_click_through,
            start_window_drag,
            get_window_position,
            set_window_position,
            resize_main_bar_window,
            broadcast_settings,
            open_settings_window,
            close_settings_window,
            quit_app,
            reset_window_to_bottom_center
        ])
        .run(tauri::generate_context!())
        .expect("AuraLine 原生桌面程序启动失败");
}
