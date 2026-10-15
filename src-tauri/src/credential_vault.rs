const TARGET_PREFIX: &str = "InkWeave/";
const MAX_SECRET_NAME_LEN: usize = 128;
const MAX_SECRET_VALUE_BYTES: usize = 2560;

fn validate_secret_name(name: &str) -> Result<(), String> {
  if name.is_empty() || name.len() > MAX_SECRET_NAME_LEN {
    return Err("凭据名称长度不合法".to_string());
  }
  if !name
    .bytes()
    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
  {
    return Err("凭据名称包含非法字符".to_string());
  }
  Ok(())
}

fn target_name(name: &str) -> Result<String, String> {
  validate_secret_name(name)?;
  Ok(format!("{}{}", TARGET_PREFIX, name))
}

#[cfg(target_os = "windows")]
fn wide_null(value: &str) -> Vec<u16> {
  use std::os::windows::ffi::OsStrExt;
  std::ffi::OsStr::new(value)
    .encode_wide()
    .chain(std::iter::once(0))
    .collect()
}

#[cfg(target_os = "windows")]
fn last_error(operation: &str) -> String {
  let code = unsafe { windows_sys::Win32::Foundation::GetLastError() };
  format!("{}失败（Windows 错误码 {}）", operation, code)
}

#[cfg(target_os = "windows")]
fn read_windows_credential(name: &str) -> Result<Option<String>, String> {
  use std::ptr::null_mut;
  use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
  use windows_sys::Win32::Security::Credentials::{
    CredFree, CredReadW, CREDENTIALW, CRED_TYPE_GENERIC,
  };

  let target = wide_null(&target_name(name)?);
  let mut raw: *mut CREDENTIALW = null_mut();
  let ok = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut raw) };
  if ok == 0 {
    let code = unsafe { GetLastError() };
    if code == ERROR_NOT_FOUND {
      return Ok(None);
    }
    return Err(format!("读取系统凭据失败（Windows 错误码 {}）", code));
  }
  if raw.is_null() {
    return Err("系统凭据返回了空指针".to_string());
  }

  let result = unsafe {
    let credential = &*raw;
    let bytes = if credential.CredentialBlobSize == 0 {
      &[][..]
    } else {
      std::slice::from_raw_parts(
        credential.CredentialBlob as *const u8,
        credential.CredentialBlobSize as usize,
      )
    };
    String::from_utf8(bytes.to_vec()).map_err(|_| "系统凭据内容不是有效 UTF-8".to_string())
  };
  unsafe { CredFree(raw as *const std::ffi::c_void) };
  result.map(Some)
}

#[cfg(target_os = "windows")]
fn write_windows_credential(name: &str, value: &str) -> Result<(), String> {
  use std::ptr::null_mut;
  use windows_sys::Win32::Foundation::FILETIME;
  use windows_sys::Win32::Security::Credentials::{
    CredWriteW, CREDENTIALW, CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
  };

  let bytes = value.as_bytes();
  if bytes.len() > MAX_SECRET_VALUE_BYTES {
    return Err(format!("凭据内容超过 {} 字节上限", MAX_SECRET_VALUE_BYTES));
  }

  let mut target = wide_null(&target_name(name)?);
  let mut user = wide_null("InkWeave");
  let mut blob = bytes.to_vec();
  let credential = CREDENTIALW {
    Flags: 0,
    Type: CRED_TYPE_GENERIC,
    TargetName: target.as_mut_ptr(),
    Comment: null_mut(),
    LastWritten: FILETIME {
      dwLowDateTime: 0,
      dwHighDateTime: 0,
    },
    CredentialBlobSize: blob.len() as u32,
    CredentialBlob: if blob.is_empty() { null_mut() } else { blob.as_mut_ptr() },
    Persist: CRED_PERSIST_LOCAL_MACHINE,
    AttributeCount: 0,
    Attributes: null_mut(),
    TargetAlias: null_mut(),
    UserName: user.as_mut_ptr(),
  };

  let ok = unsafe { CredWriteW(&credential, 0) };
  // 尽量缩短 Rust 堆上明文的生命周期。
  blob.fill(0);
  if ok == 0 {
    return Err(last_error("写入系统凭据"));
  }
  Ok(())
}

#[cfg(target_os = "windows")]
fn delete_windows_credential(name: &str) -> Result<(), String> {
  use windows_sys::Win32::Foundation::{GetLastError, ERROR_NOT_FOUND};
  use windows_sys::Win32::Security::Credentials::{CredDeleteW, CRED_TYPE_GENERIC};

  let target = wide_null(&target_name(name)?);
  let ok = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
  if ok != 0 {
    return Ok(());
  }
  let code = unsafe { GetLastError() };
  if code == ERROR_NOT_FOUND {
    return Ok(());
  }
  Err(format!("删除系统凭据失败（Windows 错误码 {}）", code))
}

#[tauri::command]
pub fn wx_secret_get(name: String) -> Result<Option<String>, String> {
  #[cfg(target_os = "windows")]
  {
    return read_windows_credential(&name);
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = target_name(&name)?;
    Err("当前桌面平台暂不支持系统凭据库".to_string())
  }
}

#[tauri::command]
pub fn wx_secret_set(name: String, value: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    return write_windows_credential(&name, &value);
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = target_name(&name)?;
    let _ = value;
    Err("当前桌面平台暂不支持系统凭据库".to_string())
  }
}

#[tauri::command]
pub fn wx_secret_delete(name: String) -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    return delete_windows_credential(&name);
  }
  #[cfg(not(target_os = "windows"))]
  {
    let _ = target_name(&name)?;
    Err("当前桌面平台暂不支持系统凭据库".to_string())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn accepts_names_used_by_the_frontend() {
    assert!(validate_secret_name("ai.primary").is_ok());
    assert!(validate_secret_name("ai.role.prose").is_ok());
  }

  #[test]
  fn rejects_names_that_could_escape_the_namespace() {
    assert!(validate_secret_name("").is_err());
    assert!(validate_secret_name("../other-app").is_err());
    assert!(validate_secret_name("name with spaces").is_err());
  }
}
