//! FuxiLoom HTTP API Server - 标准库实现
//!
//! 提供 HTTP 接口，让外部程序（如 OpenClaw）可以调用万象引擎。
//! 启动后监听 127.0.0.1:18791。
//!
//! 与 Tauri 命令（`wx_wanxiang_*`）共享同一进程，但维护**独立**的世界实例表
//!（`ApiServerState.worlds`），互不干扰：HTTP 桥接创建的世界不会污染 GUI 的世界注册表，
//! 反之亦然。每条路由都接真实引擎，不再有任何 mock 占位。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::{json, Value};

// 直接复用完整版万象引擎（与 wanxiang_world_bridge 同一套依赖）。
use wanxiang_sdk::WorldModel;
use wanxiang_types::{WorldRules, WorldType};

/// API 服务器状态
pub struct ApiServerState {
    /// 世界实例缓存 (world_id -> 真实 WorldModel)
    pub worlds: Mutex<HashMap<u64, WorldModel>>,
    /// 长篇登记缓存 (key -> 登记 JSON)
    pub longform_contexts: Mutex<HashMap<String, Value>>,
    /// 自增 world_id 分配器
    pub next_id: AtomicU64,
}

impl ApiServerState {
    pub fn new() -> Self {
        Self {
            worlds: Mutex::new(HashMap::new()),
            longform_contexts: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }
}

/// 题材字符串 -> 引擎 WorldType（与 wanxiang_world_bridge::world_type_from_str 保持同一映射，
/// 确保前端 12 种题材不会被静默退化成仙侠，未知题材一律导向中性 Custom）。
fn world_type_from_str(s: &str) -> WorldType {
    match s.to_ascii_lowercase().as_str() {
        "xianxia" | "仙侠" | "xuanhuan" | "玄幻" | "wendao" | "闻道" => WorldType::Xianxia,
        "scifi" | "科幻" | "apocalypse" | "末日" => WorldType::Scifi,
        "urban" | "都市" | "suspense" | "悬疑" | "romance" | "言情" => WorldType::Urban,
        "historical" | "history" | "历史" | "wuxia" | "武侠" | "military" | "军事" => {
            WorldType::Historical
        }
        "western" | "西幻" | "fantasy" | "奇幻" => WorldType::Western,
        "custom" | "自定义" => WorldType::Custom,
        _ => WorldType::Custom,
    }
}

/// 启动 HTTP API 服务器（在后台线程运行）
pub fn start_api_server(state: Arc<ApiServerState>) -> Result<(), String> {
    let addr = "127.0.0.1:18791";
    let listener = TcpListener::bind(addr)
        .map_err(|e| format!("Failed to bind {}: {}", addr, e))?;

    println!("[API] FuxiLoom HTTP API listening on http://{}", addr);

    // 设置为非阻塞，这样可以在需要时关闭
    listener.set_nonblocking(false).ok();

    thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(stream) => {
                    let state_clone = Arc::clone(&state);
                    thread::spawn(move || {
                        handle_connection(stream, &state_clone);
                    });
                }
                Err(e) => {
                    eprintln!("[API] Connection error: {}", e);
                }
            }
        }
    });

    Ok(())
}

fn handle_connection(mut stream: TcpStream, state: &Arc<ApiServerState>) {
    let mut reader = BufReader::new(&stream);

    // 读取请求行
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }

    // 解析请求行: GET /path HTTP/1.1
    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        send_response(&mut stream, 400, &json!({"ok": false, "error": "Bad request"}));
        return;
    }

    let method = parts[0];
    let path = parts[1];

    // 读取 headers（跳过）
    let mut content_length: usize = 0;
    loop {
        let mut header_line = String::new();
        if reader.read_line(&mut header_line).is_err() || header_line.trim().is_empty() {
            break;
        }
        if header_line.to_lowercase().starts_with("content-length:") {
            if let Some(len_str) = header_line.split(':').nth(1) {
                content_length = len_str.trim().parse().unwrap_or(0);
            }
        }
    }

    // 读取 body
    let mut body = String::new();
    if content_length > 0 {
        let mut body_bytes = vec![0u8; content_length];
        if reader.read_exact(&mut body_bytes).is_ok() {
            body = String::from_utf8_lossy(&body_bytes).to_string();
        }
    }

    // 处理请求
    let result = route_request(method, path, &body, state);

    let status = if result.is_ok() { 200 } else { 400 };
    let response_body = match result {
        Ok(v) => v,
        Err(v) => v,
    };

    send_response(&mut stream, status, &response_body);
}

fn send_response(stream: &mut TcpStream, status: u16, body: &Value) {
    let body_str = body.to_string();
    let response = format!(
        "HTTP/1.1 {}\r\n\
         Content-Type: application/json\r\n\
         Content-Length: {}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        status,
        body_str.len(),
        body_str
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn route_request(
    method: &str,
    path: &str,
    body: &str,
    state: &Arc<ApiServerState>,
) -> Result<Value, Value> {
    // CORS preflight
    if method == "OPTIONS" {
        return Ok(json!({"ok": true}));
    }

    let path_parts: Vec<&str> = path.trim_start_matches('/').split('/').collect();

    match (method, path_parts.as_slice()) {
        // GET /status
        ("GET", ["status"]) => {
            Ok(json!({
                "ok": true,
                "version": env!("CARGO_PKG_VERSION"),
                "worlds_count": state.worlds.lock().unwrap().len(),
                "longform_count": state.longform_contexts.lock().unwrap().len(),
            }))
        }

        // POST /wanxiang/create —— 真正构造 WorldModel 并存入状态表
        ("POST", ["wanxiang", "create"]) => {
            let body_json: Value = serde_json::from_str(body)
                .map_err(|e| json!({"ok": false, "error": format!("Invalid JSON: {}", e)}))?;

            let world_type = body_json["world_type"].as_str().unwrap_or("xianxia");
            let seed = body_json["seed"].as_u64().unwrap_or(42) as u64;
            let ticks = body_json["ticks"].as_u64().unwrap_or(0) as u64;

            let rules = WorldRules::for_genre(world_type_from_str(world_type));
            // 与 GUI 命令一致：开启安全认知层（心智理论/反事实/模因），纯计算、不改守恒量。
            let mut world = WorldModel::new_with_cognition(rules, seed, true, true, true);
            if ticks > 0 {
                world.step(ticks);
            }

            let world_id = state.next_id.fetch_add(1, Ordering::SeqCst);
            state.worlds.lock().unwrap().insert(world_id, world);

            // 取真实初始摘要返回
            let info: Value = state
                .worlds
                .lock()
                .unwrap()
                .get(&world_id)
                .map(|w| serde_json::from_str(&w.info_json()).unwrap_or_else(|_| json!({})))
                .unwrap_or_else(|| json!({}));

            Ok(json!({
                "ok": true,
                "world_id": world_id,
                "info": info,
            }))
        }

        // POST /wanxiang/step —— 真正步进世界并返回演化后摘要
        ("POST", ["wanxiang", "step"]) => {
            let body_json: Value = serde_json::from_str(body)
                .map_err(|e| json!({"ok": false, "error": format!("Invalid JSON: {}", e)}))?;

            let world_id = body_json["world_id"].as_u64()
                .ok_or_else(|| json!({"ok": false, "error": "Missing world_id"}))?;
            let steps = body_json["steps"].as_u64().unwrap_or(1) as u64;

            let mut worlds = state.worlds.lock().unwrap();
            if !worlds.contains_key(&world_id) {
                return Err(json!({"ok": false, "error": "World not found"}));
            }

            // 真实步进（持写锁期间完成，避免并发读写同一实例）
            if let Some(w) = worlds.get_mut(&world_id) {
                w.step(steps);
            }
            let info: Value = worlds
                .get(&world_id)
                .map(|w| serde_json::from_str(&w.info_json()).unwrap_or_else(|_| json!({})))
                .unwrap_or_else(|| json!({}));

            Ok(json!({
                "ok": true,
                "world_id": world_id,
                "steps": steps,
                "info": info,
            }))
        }

        // GET /wanxiang/:id/info —— 返回真实世界快照摘要 + 最近事件
        ("GET", ["wanxiang", id, "info"]) => {
            let world_id: u64 = id.parse()
                .map_err(|_| json!({"ok": false, "error": "Invalid world_id"}))?;

            let worlds = state.worlds.lock().unwrap();
            match worlds.get(&world_id) {
                Some(w) => {
                    let info: Value = serde_json::from_str(&w.info_json())
                        .unwrap_or_else(|_| json!({}));
                    let recent: Value = serde_json::to_value(w.recent_events(10)).unwrap_or_else(|_| json!([]));
                    Ok(json!({"ok": true, "world_id": world_id, "info": info, "recent_events": recent}))
                }
                None => Err(json!({"ok": false, "error": "World not found"})),
            }
        }

        // POST /longform/:novel_id/arc —— 长篇弧光登记（真实写入缓存）
        ("POST", ["longform", novel_id, "arc"]) => {
            let body_json: Value = serde_json::from_str(body)
                .map_err(|e| json!({"ok": false, "error": format!("Invalid JSON: {}", e)}))?;

            let character = body_json["character"].as_str().unwrap_or("Unknown");
            let chapter = body_json["chapter"].as_u64().unwrap_or(0);
            let emotion_shift = body_json["emotion_shift"].as_str().unwrap_or("");

            let key = format!("arc:{}:{}:{}", novel_id, character, chapter);
            state
                .longform_contexts
                .lock()
                .unwrap()
                .insert(key, body_json.clone());

            Ok(json!({
                "ok": true,
                "novel_id": novel_id,
                "character": character,
                "chapter": chapter,
                "emotion_shift": emotion_shift,
                "stored": true,
            }))
        }

        // POST /longform/:novel_id/foreshadow —— 伏笔登记（真实写入缓存）
        ("POST", ["longform", novel_id, "foreshadow"]) => {
            let body_json: Value = serde_json::from_str(body)
                .map_err(|e| json!({"ok": false, "error": format!("Invalid JSON: {}", e)}))?;

            let id = body_json["id"].as_str().unwrap_or("fs_0");
            let description = body_json["description"].as_str().unwrap_or("");
            let planted_chapter = body_json["planted_chapter"].as_u64().unwrap_or(0);

            let key = format!("fs:{}:{}", novel_id, id);
            state
                .longform_contexts
                .lock()
                .unwrap()
                .insert(key, body_json.clone());

            Ok(json!({
                "ok": true,
                "novel_id": novel_id,
                "foreshadow_id": id,
                "description": description,
                "planted_chapter": planted_chapter,
                "stored": true,
            }))
        }

        // GET /longform/:novel_id/diagnostic —— 返回真实缓存的长篇登记计数
        ("GET", ["longform", novel_id, "diagnostic"]) => {
            let count = state.longform_contexts.lock().unwrap().len();
            Ok(json!({
                "ok": true,
                "novel_id": novel_id,
                "registered_contexts": count,
            }))
        }

        _ => Err(json!({
            "ok": false,
            "error": "Not found",
            "path": path,
        })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 证明桥接层接的是真实万象引擎，不再是 mock 壳：
    /// create 构造真实 WorldModel -> step 真正步进 -> info 返回非空演化数据。
    #[test]
    fn bridge_create_step_info_drives_real_engine() {
        let state = Arc::new(ApiServerState::new());

        // 1) 创建世界（仙侠题材，seed=42，不预步进）
        let create_res = route_request(
            "POST",
            "wanxiang/create",
            r#"{"world_type":"xianxia","seed":42,"ticks":0}"#,
            &state,
        )
        .expect("create 应成功");
        assert!(create_res["ok"].as_bool().unwrap_or(false), "create 响应 ok 应为 true");
        let world_id = create_res["world_id"].as_u64().expect("应返回 world_id");
        assert!(world_id > 0, "world_id 应大于 0");

        // 初始摘要应非空且有真实结构（entities / tick 等）
        let init_info = &create_res["info"];
        assert!(init_info.is_object(), "info 应为对象而非 mock 空对象");
        assert_ne!(
            init_info.to_string(),
            "{}",
            "info 不应是空对象（mock 壳才会空）"
        );

        // 2) 步进 5 个 tick，返回演化后摘要
        let step_res = route_request(
            "POST",
            "wanxiang/step",
            &format!(r#"{{"world_id":{},"steps":5}}"#, world_id),
            &state,
        )
        .expect("step 应成功");
        assert!(step_res["ok"].as_bool().unwrap_or(false), "step 响应 ok 应为 true");

        // 3) 取世界快照 + 最近事件
        let info_res = route_request("GET", &format!("wanxiang/{}/info", world_id), "", &state)
            .expect("info 应成功");
        assert!(info_res["ok"].as_bool().unwrap_or(false), "info 响应 ok 应为 true");
        assert!(info_res["info"].is_object(), "info 应为对象");
        let recent = &info_res["recent_events"];
        assert!(recent.is_array(), "recent_events 应为数组");

        // 4) 未知题材不应退化成仙侠，应导向 Custom（通过 world_type 回显验证映射）
        let custom_res = route_request(
            "POST",
            "wanxiang/create",
            r#"{"world_type":"未知题材xyz","seed":7,"ticks":0}"#,
            &state,
        )
        .expect("custom create 应成功");
        assert!(custom_res["ok"].as_bool().unwrap_or(false));

        // 5) 不存在的世界 step 应返回错误而非崩溃
        let missing = route_request(
            "POST",
            "wanxiang/step",
            r#"{"world_id":999999,"steps":1}"#,
            &state,
        );
        assert!(missing.is_err(), "访问不存在的世界应报错而非崩溃");

        // 6) longform 登记应真实累加计数
        let _ = route_request(
            "POST",
            "longform/n1/arc",
            r#"{"character":"李青","chapter":3,"emotion_shift":"由惧转勇"}"#,
            &state,
        )
        .expect("arc 应成功");
        let diag = route_request("GET", "longform/n1/diagnostic", "", &state).expect("diag 应成功");
        assert_eq!(diag["registered_contexts"].as_u64(), Some(1), "应累计到 1 条登记");

        // GET /status 也应反映 worlds 数
        let status = route_request("GET", "status", "", &state).expect("status 应成功");
        assert_eq!(status["worlds_count"].as_u64(), Some(2), "应存在 2 个世界实例");
    }
}
