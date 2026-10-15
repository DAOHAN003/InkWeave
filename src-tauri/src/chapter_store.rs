//! 章节正文外置存储（解决 localStorage 配额硬伤）
//!
//! 背景：`saveNovels` 原先把整库（含全部章节正文）JSON 序列化后写进 localStorage 单键，
//! 实测 100 万字约 3.0MB、200 万字约 6.0MB，会撞爆 5MB 配额导致保存失败。
//!
//! 方案：正文按作品外置到 `<app_data_dir>/fx_chapters/<novel_id>.json`，
//! localStorage 只保留「瘦身版」（正文置空 + 标记），内存中的 Novel 结构保持完整，
//! 因此 88 处直接读 `chapter.content` 的代码零改动。
//!
//! 安全约束：只有文件写入成功后，调用方才可写瘦身版到 localStorage；
//! 否则必须保留全量，确保任何情况下都不丢稿。

use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn chapters_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法定位 app_data_dir: {e}"))?;
    Ok(base.join("fx_chapters"))
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

/// 保存某作品的章节正文到文件。返回写入的文件路径。
// 参数名必须保持 camelCase：Tauri 在 JS 端按 camelCase 传参，改成 snake_case 会静默失败。
#[allow(non_snake_case)]
#[tauri::command]
pub fn wx_chapter_store_save(
    app: tauri::AppHandle,
    novelId: String,
    payload: String,
) -> Result<String, String> {
    let dir = chapters_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建章节目录失败: {}", e))?;
    let path = dir.join(format!("{}.json", safe_name(&novelId)));
    // 先写临时文件再重命名，避免写一半崩溃留下损坏文件
    let tmp = dir.join(format!("{}.json.tmp", safe_name(&novelId)));
    fs::write(&tmp, payload.as_bytes()).map_err(|e| format!("章节正文写入失败: {}", e))?;
    fs::rename(&tmp, &path).map_err(|e| format!("章节正文落盘失败: {}", e))?;
    Ok(path.to_string_lossy().into_owned())
}

/// 读取某作品的章节正文。文件不存在返回 Ok(None)——与「读取出错」区分开，
/// 便于调用方判断是「尚未外置过」还是「真的坏了」。
// 参数名必须保持 camelCase：Tauri 在 JS 端按 camelCase 传参，改成 snake_case 会静默失败。
#[allow(non_snake_case)]
#[tauri::command]
pub fn wx_chapter_store_load(app: tauri::AppHandle, novelId: String) -> Result<Option<String>, String> {
    let dir = chapters_dir(&app)?;
    let path = dir.join(format!("{}.json", safe_name(&novelId)));
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("读取章节正文失败: {}", e))?;
    Ok(Some(content))
}

/// 删除某作品的外置正文（如删除作品时清理）。
// 参数名必须保持 camelCase：Tauri 在 JS 端按 camelCase 传参，改成 snake_case 会静默失败。
#[allow(non_snake_case)]
#[tauri::command]
pub fn wx_chapter_store_delete(app: tauri::AppHandle, novelId: String) -> Result<(), String> {
    let dir = chapters_dir(&app)?;
    let path = dir.join(format!("{}.json", safe_name(&novelId)));
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除章节正文失败: {}", e))?;
    }
    Ok(())
}
