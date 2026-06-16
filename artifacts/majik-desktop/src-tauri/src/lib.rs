#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                use window_vibrancy::apply_mica;

                if let Some(window) = app.get_webview_window("main") {
                    let _ = apply_mica(&window, Some(true));
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Majik");
}
