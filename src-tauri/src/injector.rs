use crate::state::AdvancedConfig;
use std::thread::sleep;
use std::time::Duration;
use arboard::Clipboard;
use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};

pub fn inject_text(text: &str, config: &AdvancedConfig) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }

    let mut formatted = text.to_string();
    if config.append_trailing_space && !formatted.ends_with(' ') {
        formatted.push(' ');
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("Enigo init failed: {e}"))?;

    if config.paste_method == "direct_type" {
        enigo.text(&formatted).map_err(|e| format!("Direct type failed: {e}"))?;
    } else {
        let mut clipboard = Clipboard::new().map_err(|e| format!("Clipboard init failed: {e}"))?;

        // Save previous clipboard text if available and requested
        let prev_text = if config.clipboard_handling == "restore" {
            clipboard.get_text().ok()
        } else {
            None
        };

        // Set new text to paste (ensure Windows \r\n format for universal clipboard pasting)
        #[cfg(windows)]
        let text_to_set = formatted.replace("\r\n", "\n").replace('\n', "\r\n");
        #[cfg(not(windows))]
        let text_to_set = formatted;

        clipboard
            .set_text(&text_to_set)
            .map_err(|e| format!("Failed to set clipboard text: {e}"))?;

        // Wait a brief moment for the clipboard to settle
        sleep(Duration::from_millis(30));

        if config.paste_method == "ctrl_shift_v" {
            enigo.key(Key::Control, Press).map_err(|e| format!("Key press failed: {e}"))?;
            enigo.key(Key::Shift, Press).map_err(|e| format!("Key press failed: {e}"))?;
            enigo.key(Key::Unicode('v'), Click).map_err(|e| format!("Key click failed: {e}"))?;
            enigo.key(Key::Shift, Release).map_err(|e| format!("Key release failed: {e}"))?;
            enigo.key(Key::Control, Release).map_err(|e| format!("Key release failed: {e}"))?;
        } else {
            // Default: Ctrl+V
            enigo.key(Key::Control, Press).map_err(|e| format!("Key press failed: {e}"))?;
            enigo.key(Key::Unicode('v'), Click).map_err(|e| format!("Key click failed: {e}"))?;
            enigo.key(Key::Control, Release).map_err(|e| format!("Key release failed: {e}"))?;
        }

        // Allow target app time to process the paste before restoring clipboard
        sleep(Duration::from_millis(100));

        if let Some(prev) = prev_text {
            let _ = clipboard.set_text(prev);
        }
    }

    // Auto-submit handling
    match config.auto_submit.as_str() {
        "enter" => {
            sleep(Duration::from_millis(30));
            enigo.key(Key::Return, Click).map_err(|e| format!("Auto submit enter failed: {e}"))?;
        }
        "ctrl_enter" => {
            sleep(Duration::from_millis(30));
            enigo.key(Key::Control, Press).map_err(|e| format!("Key press failed: {e}"))?;
            enigo.key(Key::Return, Click).map_err(|e| format!("Key click failed: {e}"))?;
            enigo.key(Key::Control, Release).map_err(|e| format!("Key release failed: {e}"))?;
        }
        _ => {}
    }

    Ok(())
}
