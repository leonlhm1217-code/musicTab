mod audio_loopback;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

const SINGLE_INSTANCE_ADDR: &str = "127.0.0.1:49172";
static CLICK_THROUGH_ACTIVE: AtomicBool = AtomicBool::new(false);

/// Single-instance protection:
/// If another AuraLine.exe is already running, notifies it to focus/open Settings and exits immediately.
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
fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    CLICK_THROUGH_ACTIVE.store(ignore, Ordering::SeqCst);
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_window_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_window_position(window: WebviewWindow) -> Result<(i32, i32), String> {
    let pos = window.outer_position().map_err(|e| e.to_string())?;
    Ok((pos.x, pos.y))
}

#[tauri::command]
fn set_window_position(window: WebviewWindow, x: i32, y: i32) -> Result<(), String> {
    window
        .set_position(Position::Physical(PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_main_bar_window(app: AppHandle, line_width: f64, line_height: f64) -> Result<(), String> {
    if let Some(main_win) = app.get_webview_window("main") {
        let target_w = (line_width + 110.0).max(240.0);
        let target_h = (line_height + 40.0).max(48.0);
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
fn open_settings_window(app: AppHandle) -> Result<(), String> {
    open_or_focus_settings_window(&app);
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn reset_window_to_bottom_center(window: WebviewWindow) -> Result<(i32, i32), String> {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let screen = monitor.size();
        let win_size = window
            .outer_size()
            .unwrap_or(tauri::PhysicalSize { width: 480, height: 52 });
        let x = ((screen.width as i32) - (win_size.width as i32)) / 2;
        let y = (screen.height as i32) - (win_size.height as i32) - 96;
        let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
        return Ok((x, y));
    }
    let _ = window.set_position(Position::Physical(PhysicalPosition { x: 400, y: 820 }));
    Ok((400, 820))
}

fn open_or_focus_settings_window(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window("settings") {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return;
    }

    let _ = WebviewWindowBuilder::new(
        app,
        "settings",
        WebviewUrl::App("index.html#settings".into()),
    )
    .title("AuraLine — 隐身细线设置")
    .inner_size(460.0, 600.0)
    .resizable(false)
    .decorations(true)
    .transparent(false)
    .center()
    .build();
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
    let open_settings = MenuItem::with_id(
        app,
        "open_settings",
        "打开设置页面...",
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
        .tooltip("AuraLine — 隐身声学细线 (左键打开设置 / 右键快捷菜单)")
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
    // 0. 单实例防多开保护：若已有实例在运行，唤醒其设置窗口并退出当前新进程
    let Some(instance_listener) = acquire_single_instance_lock() else {
        std::process::exit(0);
    };

    tauri::Builder::default()
        .setup(move |app| {
            let handle = app.handle().clone();
            // 1. 启动单实例唤醒监听线程
            spawn_single_instance_wakeup_listener(instance_listener, handle.clone());
            // 2. 初始化右下角 Windows 系统托盘图标与右键控制菜单
            let _ = setup_system_tray(&handle);
            // 3. 启动 100% 纯输出端声卡回环监听 (仅限 default_output_device，物理禁用麦克风)
            audio_loopback::spawn_soundcard_loopback(handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_auto_start_enabled,
            set_auto_start_enabled,
            set_click_through,
            start_window_drag,
            get_window_position,
            set_window_position,
            resize_main_bar_window,
            broadcast_settings,
            open_settings_window,
            quit_app,
            reset_window_to_bottom_center
        ])
        .run(tauri::generate_context!())
        .expect("AuraLine 原生桌面程序启动失败");
}
