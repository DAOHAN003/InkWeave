//! 统一日志：把运行期错误与崩溃落盘到 `<app_data_dir>/logs`，供「日志」面板查看，
//! 避免命令静默失败或前端白屏。前端崩溃 / 未处理异常 / Rust panic 都会到这里。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024; // 单文件 2MB，超出滚动到 app.1.log

/// 崩溃日志目录（由 main 在启动时注入，panic 钩子无 AppHandle 可用）
static CRASH_LOG_DIR: OnceLock<PathBuf> = OnceLock::new();

/// 应用日志路径：<app_data_dir>/logs/app.log
fn log_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位 app_data_dir: {e}"))?;
    Ok(base.join("logs"))
}

#[tauri::command]
pub fn wx_log_write(
    app: tauri::AppHandle,
    level: String,
    message: String,
    source: Option<String>,
) -> Result<(), String> {
    let dir = log_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建日志目录失败: {}", e))?;
    let path = dir.join("app.log");
    // 超出上限则滚动
    if let Ok(meta) = fs::metadata(&path) {
        if meta.len() > MAX_LOG_BYTES {
            let _ = fs::rename(&path, dir.join("app.1.log"));
        }
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let src = source.unwrap_or_else(|| "app".to_string());
    let line = format!("[{}] {} [{}] {}\n", ts, level, src, message);
    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("打开日志文件失败: {}", e))?;
    f.write_all(line.as_bytes())
        .map_err(|e| format!("写日志失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn wx_log_read(app: tauri::AppHandle, lines: Option<usize>) -> Result<Vec<String>, String> {
    let dir = log_dir(&app)?;
    let path = dir.join("app.log");
    let content = fs::read_to_string(&path).unwrap_or_default();
    let all: Vec<String> = content.lines().map(|s| s.to_string()).collect();
    let n = lines.unwrap_or(300);
    let start = all.len().saturating_sub(n);
    Ok(all.into_iter().skip(start).collect())
}

/// 安装全局 panic 钩子：把 Rust 端崩溃信息落盘到 <app_data_dir>/logs/panic.log。
/// 同时保留默认钩子（打印到 stderr / 崩溃弹窗），方便排查。
/// `app_data` 由 main 在启动时从 Config 解析后注入（panic 上下文拿不到 AppHandle）。
pub fn install_crash_logger(app_data: PathBuf) {
    let _ = CRASH_LOG_DIR.set(app_data.join("logs"));
    let old = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!(
            "PANIC @ {}: {}",
            location_str(info.location()),
            payload_str(info.payload())
        );
        let _ = write_crash(&msg);
        old(info);
    }));
}

fn location_str(loc: Option<&std::panic::Location>) -> String {
    match loc {
        Some(l) => format!("{}:{}:{}", l.file(), l.line(), l.column()),
        None => "unknown".to_string(),
    }
}

fn payload_str(p: &dyn std::any::Any) -> String {
    if let Some(s) = p.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = p.downcast_ref::<String>() {
        s.clone()
    } else {
        "Box<dyn Any>".to_string()
    }
}

fn write_crash(msg: &str) -> std::io::Result<()> {
    let dir = CRASH_LOG_DIR
        .get()
        .cloned()
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("panic.log");
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let line = format!("[{}] {}\n", ts, msg);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)?
        .write_all(line.as_bytes())?;
    Ok(())
}
