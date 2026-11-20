use std::thread::sleep;
use std::time::Duration;
use arboard::Clipboard;
use enigo::{
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Settings,
};

pub fn inject_text(text: &str) -> Result<(), String> {
    if text.trim().is_empty() {
        return Ok(());
    }

    let mut clipboard = Clipboard::new().map_err(|e| format!("Clipboard init failed: {e}"))?;

    // Save previous clipboard text if available
    let prev_text = clipboard.get_text().ok();

    // Set new text to paste (ensure Windows \r\n format for universal clipboard pasting)
    #[cfg(windows)]
    let text_to_set = text.replace("\r\n", "\n").replace('\n', "\r\n");
    #[cfg(not(windows))]
    let text_to_set = text.to_string();

    clipboard
        .set_text(&text_to_set)
        .map_err(|e| format!("Failed to set clipboard text: {e}"))?;

    // Wait a brief moment for the clipboard to settle
    sleep(Duration::from_millis(30));

    // Simulate Ctrl+V to paste into active window
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("Enigo init failed: {e}"))?;
    enigo.key(Key::Control, Press).map_err(|e| format!("Key press failed: {e}"))?;
    enigo.key(Key::Unicode('v'), Click).map_err(|e| format!("Key click failed: {e}"))?;
    enigo.key(Key::Control, Release).map_err(|e| format!("Key release failed: {e}"))?;

    // Allow the target application to read the clipboard before restoring
    sleep(Duration::from_millis(100));

    // Restore previous clipboard content if there was any
    if let Some(prev) = prev_text {
        let _ = clipboard.set_text(prev);
    }

    Ok(())
}
