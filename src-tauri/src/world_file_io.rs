//! world_file_io — 世界设定文件读写（绕过 JS 侧 fs.scope 限制）
//!
//! 前端 `@tauri-apps/api/fs` 的 `readTextFile` 受 `tauri.conf.json` 的 `fs.scope` 约束
//! （当前仅 `$APPDATA` / `$DOCUMENT` / `$DOWNLOAD`），用户从桌面或任意盘选设定文件会被拒。
//! 这里改由 Rust 侧直读/直写：路径均由用户经系统文件对话框亲自选定，不构成越权。
//!
//! 编码策略：只接受 UTF-8（含 BOM）。非 UTF-8（Windows 中文旧稿常见的 GBK/ANSI）不做
//! 猜测式解码——猜错会把乱码当成势力名喂进模拟器，产出一个看似成功实则全是垃圾的世界，
//! 比直接报错更难排查。因此返回一条可操作的错误提示，让用户另存为 UTF-8。
//!
//! 安全：路径均由用户经系统文件对话框亲自选定，故**不绑定「用户选定根」白名单**（避免
//! check() 默认拒绝误伤合法对话框路径）。仅在读写前用静态原语做最小门禁——
//! `FileSystemSandbox::detect_traversal` 拒绝 `../` 穿越 + `normalize_path` 后逐一比对
//! `FORBIDDEN_PATHS` 全局禁止区。

use security_suite::{FileSystemSandbox, FORBIDDEN_PATHS};

/// 路径沙箱静态校验：拒绝穿越序列（../ / ..\ / %2e%2e）+ 命中全局禁止区。
///
/// 仅用 `detect_traversal` + `normalize_path` + `FORBIDDEN_PATHS` 三个静态原语，
/// **不调用** `FileSystemSandbox::check()`——后者默认拒绝、需白名单，会误伤用户经
/// 对话框选定的合法路径（如桌面/下载盘任意位置）。命中即返回 Err(String)。
fn assert_path_safe(path: &str) -> Result<(), String> {
    // 1) 穿越检测：../ / ..\ / %2e%2e(/ 或 \)
    if FileSystemSandbox::detect_traversal(path) {
        return Err(format!("路径包含目录穿越序列，拒绝访问: {}", path));
    }
    // 2) 规范化后逐一比对全局禁止区（任一片段命中即拒绝）
    let normalized = FileSystemSandbox::normalize_path(path);
    for forbidden in FORBIDDEN_PATHS {
        if normalized.contains(forbidden) {
            return Err(format!("路径命中禁止区，拒绝访问: {}", forbidden));
        }
    }
    Ok(())
}

/// 读取任意路径的文本文件；剥离 UTF-8 BOM。非 UTF-8 时给出可操作的错误提示。
#[tauri::command]
pub fn wx_read_world_file(path: String) -> Result<String, String> {
    assert_path_safe(&path)?;
    let raw = std::fs::read(&path).map_err(|e| format!("读取文件失败: {}", e))?;
    let bytes: &[u8] = if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        &raw[3..]
    } else {
        &raw[..]
    };
    match std::str::from_utf8(bytes) {
        Ok(s) => Ok(s.to_string()),
        Err(_) => Err(format!(
            "文件不是 UTF-8 编码（可能是 GBK/ANSI）：{}。请用记事本打开后「另存为」并把编码选成 UTF-8，再重新载入。",
            path
        )),
    }
}

/// 写文本文件到任意路径（自动创建父目录），返回写入的路径。
#[tauri::command]
pub fn wx_write_world_file(path: String, content: String) -> Result<String, String> {
    assert_path_safe(&path)?;
    let p = std::path::Path::new(&path);
    if let Some(dir) = p.parent() {
        if !dir.as_os_str().is_empty() {
            std::fs::create_dir_all(dir).map_err(|e| format!("创建目录失败: {}", e))?;
        }
    }
    std::fs::write(p, content.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_dir() -> std::path::PathBuf {
        let d = std::env::temp_dir().join("fx_wx_file_io_test");
        let _ = std::fs::create_dir_all(&d);
        d
    }

    #[test]
    fn write_then_read_roundtrip_utf8() {
        let f = tmp_dir().join("spec.json");
        let path = f.to_string_lossy().to_string();
        let content = String::from("{\"genre\":\"xianxia\",\"factions\":[{\"name\":\"青云门\"}]}");
        let written = wx_write_world_file(path.clone(), content.clone()).expect("write ok");
        assert_eq!(written, path);
        let back = wx_read_world_file(path).expect("read ok");
        assert_eq!(back, content);
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn write_creates_missing_parent_dirs() {
        let f = tmp_dir().join("nested").join("deep").join("out.json");
        let path = f.to_string_lossy().to_string();
        let _ = std::fs::remove_file(&f);
        wx_write_world_file(path.clone(), "{}".to_string()).expect("write ok");
        assert!(f.exists(), "父目录未自动创建");
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn read_strips_utf8_bom() {
        let f = tmp_dir().join("bom.md");
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("## 势力\n- 青云门\n".as_bytes());
        std::fs::write(&f, &bytes).expect("write bom file");
        let s = wx_read_world_file(f.to_string_lossy().to_string()).expect("read ok");
        assert!(s.starts_with("## 势力"), "BOM 未剥离");
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn non_utf8_reports_actionable_error_instead_of_garbage() {
        let f = tmp_dir().join("gbk.txt");
        // GBK 编码的「势力」二字，故意不是合法 UTF-8
        let bytes: [u8; 4] = [0xCA, 0xC6, 0xC1, 0xA6];
        std::fs::write(&f, bytes).expect("write gbk file");
        let err = wx_read_world_file(f.to_string_lossy().to_string()).unwrap_err();
        assert!(err.contains("UTF-8"), "错误提示应说明编码问题: {}", err);
        assert!(err.contains("另存为"), "错误提示应给出可操作建议: {}", err);
        let _ = std::fs::remove_file(&f);
    }

    #[test]
    fn read_missing_file_errors() {
        let r = wx_read_world_file("Z:/definitely/not/here/xyz.json".to_string());
        assert!(r.is_err());
    }
}
