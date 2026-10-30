mod audio_loopback;

use tauri::Window;

#[tauri::command]
fn set_click_through(window: Window, ignore: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_window_drag(window: Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // 启动即全自动绑定本机默认声卡硬件环回 (WASAPI Loopback / CoreAudio)，支持耳机插拔自动重连
            audio_loopback::spawn_soundcard_loopback(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            start_window_drag
        ])
        .run(tauri::generate_context!())
        .expect("AuraLine 原生桌面程序启动失败");
}
