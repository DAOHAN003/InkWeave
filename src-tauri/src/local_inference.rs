//! 本地推理 sidecar（改造 P1-B）
//!
//! 把 KoboldCpp / llama.cpp-server 作为本地子进程拉起，经其 OpenAI 兼容端口
//! （http://127.0.0.1:<port>/v1）接入。前端 AI 请求层（P0 路由）零改动即可使用。
//!
//! 设计取舍：不使用 Tauri `externalBin` 静态注册，而是按路径解析二进制——
//! 因为 externalBin 在构建期就要求二进制存在，会卡死本仓库现有 dev/build 流程。
//! 这里改为：优先用 UI 传入的绝对路径；否则查 <resource_dir>/binaries/<engine>[.exe]。
//! 二进制缺失时返回清晰指引而非破坏整个应用构建。

use std::net::{SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

pub struct LocalInferenceState {
    pub child: Mutex<Option<Child>>,
    pub running: Mutex<Option<RunningInfo>>,
}

#[derive(Clone)]
pub(crate) struct RunningInfo {
    engine: String,
    port: u16,
    base_url: String,
    binary: String,
    model: Option<String>,
}

impl LocalInferenceState {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            running: Mutex::new(None),
        }
    }
}

/// 解析本地推理二进制路径：UI 显式路径优先，否则查资源目录 binaries/
fn resolve_binary(app: &AppHandle, engine: &str, binary_path: Option<String>) -> Result<String, String> {
    if let Some(p) = binary_path {
        if Path::new(&p).exists() {
            return Ok(p);
        }
        return Err(format!("指定的二进制路径不存在: {}", p));
    }
    let candidates: Vec<String> = if cfg!(target_os = "windows") {
        vec![
            format!("{}.exe", engine),
            engine.to_string(),
            format!("{}-x86_64-pc-windows-msvc.exe", engine),
        ]
    } else {
        vec![engine.to_string(), format!("{}.bin", engine)]
    };
    if let Some(res) = app.path().resource_dir().ok() {
        for name in candidates {
            let p = res.join("binaries").join(name.as_str());
            if p.exists() {
                return Ok(p.to_string_lossy().into_owned());
            }
        }
    }
    Err(format!(
        "未找到 {} 二进制。请二选一：\n\
         1) 把它放到 <安装目录>/resources/binaries/{}.exe\n\
         2) 在「模型」面板的「本地推理」中填写二进制绝对路径。\n\
         下载：KoboldCpp https://github.com/LostRuins/koboldcpp ｜ llama.cpp https://github.com/ggerganov/llama.cpp",
        engine, engine
    ))
}

/// 推荐启动档：全量 GPU 层 + 大上下文 + q8 KV 缓存 + flash attention
fn build_args(
    engine: &str,
    model: &Option<String>,
    port: u16,
    extra: &Option<Vec<String>>,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    match engine {
        "koboldcpp" => {
            args.extend([
                "--port".into(),
                port.to_string(),
                "--gpulayers".into(),
                "99".into(),
                "--contextsize".into(),
                "16384".into(),
                "--cache-q8".into(),
                "--flashattention".into(),
            ]);
            if let Some(m) = model {
                args.extend(["--model".into(), m.clone()]);
            }
        }
        "llamacpp" => {
            args.extend([
                "--host".into(),
                "127.0.0.1".into(),
                "--port".into(),
                port.to_string(),
                "-ngl".into(),
                "99".into(),
                "--ctx-size".into(),
                "16384".into(),
                "--cache-q8".into(),
                "-fa".into(),
                "--api-key".into(),
                "none".into(),
            ]);
            if let Some(m) = model {
                args.extend(["--model".into(), m.clone()]);
            }
        }
        _ => {}
    }
    if let Some(e) = extra {
        args.extend(e.iter().cloned());
    }
    args
}

/// 轮询端口就绪（最多 timeout）
fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    let start = Instant::now();
    while start.elapsed() <= timeout {
        if let Ok(sa) = addr.parse::<SocketAddr>() {
            if TcpStream::connect_timeout(&sa, Duration::from_millis(400)).is_ok() {
                return true;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

fn stop_internal(state: &State<LocalInferenceState>) {
    if let Ok(mut c) = state.child.lock() {
        if let Some(mut child) = c.take() {
            let _ = child.kill();
        }
    }
    if let Ok(mut r) = state.running.lock() {
        *r = None;
    }
}

#[tauri::command]
pub fn start_local_inference(
    state: State<LocalInferenceState>,
    app: AppHandle,
    engine: String,
    model_path: Option<String>,
    binary_path: Option<String>,
    port: Option<u16>,
    extra_args: Option<Vec<String>>,
) -> Result<Value, String> {
    let engine = engine.to_lowercase();
    if engine != "koboldcpp" && engine != "llamacpp" {
        return Err(format!("不支持的引擎: {}（支持 koboldcpp / llamacpp）", engine));
    }

    // 若已运行则先停，避免端口占用
    stop_internal(&state);

    let bin = resolve_binary(&app, &engine, binary_path)?;
    let port = port.unwrap_or(if engine == "koboldcpp" { 5001 } else { 8080 });
    let args = build_args(&engine, &model_path, port, &extra_args);

    // v2：改用 std::process（v1 tauri::api::process 已移除）。输出丢弃，与 v1 行为一致。
    let child = Command::new(bin.as_str())
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("启动 {} 失败: {}（二进制: {}）", engine, e, bin))?;

    let base_url = format!("http://127.0.0.1:{}/v1", port);
    let ready = wait_for_port(port, Duration::from_secs(60));

    {
        let mut run = state
            .running
            .lock()
            .map_err(|_| "运行状态锁失败".to_string())?;
        *run = Some(RunningInfo {
            engine: engine.clone(),
            port,
            base_url: base_url.clone(),
            binary: bin.clone(),
            model: model_path.clone(),
        });
    }
    {
        let mut c = state.child.lock().map_err(|_| "子进程锁失败".to_string())?;
        *c = Some(child);
    }

    Ok(json!({
        "engine": engine,
        "port": port,
        "base_url": base_url,
        "binary": bin,
        "ready": ready,
        "note": if ready {
            "本地推理已就绪：可将「模型」面板的 Base URL 设为上述地址、后端类型选 llamacpp"
        } else {
            "进程已启动但 60s 内端口未就绪，请检查模型加载日志 / 显存是否足够"
        }
    }))
}

#[tauri::command]
pub fn stop_local_inference(state: State<LocalInferenceState>) -> Result<Value, String> {
    stop_internal(&state);
    Ok(json!({ "stopped": true }))
}

#[tauri::command]
pub fn local_inference_status(state: State<LocalInferenceState>) -> Value {
    let running = state
        .running
        .lock()
        .map(|r| r.clone())
        .unwrap_or(None);
    match running {
        Some(info) => json!({
            "running": true,
            "engine": info.engine,
            "port": info.port,
            "base_url": info.base_url,
            "binary": info.binary,
            "model": info.model,
        }),
        None => json!({ "running": false }),
    }
}
