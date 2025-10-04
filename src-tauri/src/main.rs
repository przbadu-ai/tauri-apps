// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command as AsyncCommand;

#[derive(Serialize, Deserialize)]
struct ChatResponse {
    success: bool,
    message: Option<String>,
    error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct StreamChunk {
    #[serde(rename = "type")]
    chunk_type: String,
    content: Option<String>,
    success: Option<bool>,
    error: Option<String>,
}

#[tauri::command]
fn check_python_available() -> Result<bool, String> {
    let python_cmd = if cfg!(target_os = "windows") { "python" } else { "python3" };

    match Command::new(python_cmd).arg("--version").output() {
        Ok(output) => Ok(output.status.success()),
        Err(_) => Ok(false),
    }
}

#[tauri::command]
fn send_to_python(message: String) -> Result<ChatResponse, String> {
    // Python exec
    let python_cmd = if cfg!(target_os = "windows") { "python" } else { "python3" };

    // Get the path to the Python script
    let python_script = if cfg!(debug_assertions) {
        // Development: get absolute path
        let mut path = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?;
        path.push("python");
        path.push("chat_handler.py");
        path
    } else {
        // Production: bundle with the app
        PathBuf::from("python/chat_handler.py")
    };

    if !python_script.exists() {
        return Err(format!("Python script not found at: {:?}", python_script));
    }

    // Execute python script
    let output = Command::new(python_cmd)
        .arg(python_script)
        .arg(&message)
        .output()
        .map_err(|e| format!("Failed to execute python: {}", e))?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let response: ChatResponse = serde_json::from_str(&stdout)
            .map_err(|e| format!("Failed to parse python response: {}", e))?;
        Ok(response)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Python script failed: {}", stderr))
    }
}

#[tauri::command]
async fn send_to_python_stream(
    window: tauri::Window,
    message: String,
) -> Result<(), String> {
    // Python exec
    let python_cmd = if cfg!(target_os = "windows") { "python" } else { "python3" };

    // Get the path to the Python script
    let python_script = if cfg!(debug_assertions) {
        // Development: get absolute path
        let mut path = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?;
        path.push("python");
        path.push("chat_handler.py");
        path
    } else {
        // Production: bundle with the app
        PathBuf::from("python/chat_handler.py")
    };

    if !python_script.exists() {
        return Err(format!("Python script not found at: {:?}", python_script));
    }

    // Execute python script
    let mut child = AsyncCommand::new(python_cmd)
        .arg(python_script)
        .arg(&message)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to execute python: {}", e))?;

    // Get stdout handle
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;

    //Create buffered reader for line-by-line reading
    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    // Read and emit each line as it comes
    while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
        if let Ok(chunk) = serde_json::from_str::<StreamChunk>(&line) {
            window
                .emit("stream-chunk", &chunk)
                .map_err(|e| e.to_string())?;
        }
    }

    child.wait().await.map_err(|e| e.to_string())?;

    Ok(())
}

fn main() {
    // learn01_lib::run();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            send_to_python,
            check_python_available,
            send_to_python_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
