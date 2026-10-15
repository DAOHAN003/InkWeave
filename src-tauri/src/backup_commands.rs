//! 文件级备份与恢复（数据安全网）
//!
//! 把 localStorage 主存之外的第二道防线：把关键 JSON 快照落到
//! `<app_data_dir>/fx_backup/<safe_key>.<ts>.json`，保留最近 N 份。
//! 即便用户清空浏览器缓存或 localStorage 配额溢出，也能从文件找回。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const MAX_BACKUPS_PER_KEY: usize = 10;

fn backup_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位 app_data_dir: {e}"))?;
    Ok(base.join("fx_backup"))
}

/// 仅保留字母、数字、下划线、点、连字符，防止路径穿越/非法文件名
fn safe_name(key: &str) -> String {
    let mut out = String::with_capacity(key.len());
    for c in key.chars() {
        if c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-' {
            out.push(c);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        out.push_str("default");
    }
    out
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn wx_backup_save(app: tauri::AppHandle, key: String, payload: String) -> Result<String, String> {
    let dir = backup_dir(&app)?;
    let _ = fs::create_dir_all(&dir);
    let name = format!("{}.{}.json", safe_name(&key), now_ms());
    let path = dir.join(&name);
    fs::write(&path, payload.as_bytes()).map_err(|e| format!("备份写入失败: {}", e))?;
    // 保留最近 N 份，删除更旧的
    if let Ok(entries) = fs::read_dir(&dir) {
        let prefix = format!("{}.", safe_name(&key));
        let mut files: Vec<PathBuf> = entries
            .filter_map(|e| e.ok().map(|x| x.path()))
            .filter(|p| {
                let s = p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
                s.starts_with(&prefix) && s.ends_with(".json")
            })
            .collect();
        files.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
        for old in files.iter().skip(MAX_BACKUPS_PER_KEY) {
            let _ = fs::remove_file(old);
        }
    }
    Ok(path.to_string_lossy().into_owned())
}

#[derive(serde::Serialize)]
pub struct BackupMeta {
    pub path: String,
    pub size: u64,
    pub modified: i64,
}

#[tauri::command]
pub fn wx_backup_list(app: tauri::AppHandle, key: String) -> Result<Vec<BackupMeta>, String> {
    let dir = backup_dir(&app)?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let prefix = format!("{}.", safe_name(&key));
    let mut list: Vec<BackupMeta> = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| format!("读取备份目录失败: {}", e))?;
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let fname = entry.file_name().to_string_lossy().to_string();
        if !fname.starts_with(&prefix) || !fname.ends_with(".json") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        list.push(BackupMeta {
            path: entry.path().to_string_lossy().into_owned(),
            size: meta.len(),
            modified,
        });
    }
    list.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(list)
}

#[tauri::command]
pub fn wx_backup_restore(app: tauri::AppHandle, key: String, path: Option<String>) -> Result<String, String> {
    let dir = backup_dir(&app)?;
    let content = match path {
        Some(p) => {
            // 校验请求的路径确实位于备份目录内，防穿越
            let target = Path::new(&p);
            if !target.starts_with(&dir) {
                return Err("非法的备份路径".to_string());
            }
            fs::read_to_string(&target).map_err(|e| format!("读取备份失败: {}", e))?
        }
        None => {
            let list = wx_backup_list(app, key.clone())?;
            if list.is_empty() {
                return Err("没有可用的备份".to_string());
            }
            let latest = &list[0].path;
            fs::read_to_string(latest).map_err(|e| format!("读取最新备份失败: {}", e))?
        }
    };
    Ok(content)
}
