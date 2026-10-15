// ============================================================================
// 长篇前情 RAG —— 自有章节向量召回（治长篇遗忘）
//
// 设计：
//  - 本模块是**纯 Rust 的向量索引引擎**：建索引、按 novel_id 落盘、召回排序。
//  - 向量本身由前端（`ragRecall.ts`）计算后传入：
//      · 语义嵌入（bge-m3 等，经 OpenAI 兼容 /v1/embeddings 调用）——真正的语义召回；
//      · 离线词向量（确定性 fnv1a32 n-gram，256 维）——无嵌入提供方时的零网络回退。
//    命令签名只收「预计算向量」，因此嵌入模型/后端可自由替换，Rust 侧零依赖、零 C++。
//  - 召回 = 当前草稿向量与全库余弦相似度排序，过滤掉「当前章」自身，返回 Top-K。
//
// 关于 usearch：原计划用 usearch ANN，但其 C 内核 numkong 在 MSVC 工具链上把
// `-std:c99` 传给 cl.exe 导致构建失败（cargo check EXIT=101）。小说规模（数百段落）
// 下精确余弦本就亚毫秒，ANN 无收益，故保留纯 Rust 精确索引——确定性强、零依赖、可单测。
// 若日后迁移到能编译 numkong 的工具链，把排序换成 usearch Index 仅是局部改动。
// ============================================================================

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ─── 输入：前端已切块 + 预计算向量 ───

#[derive(Serialize, Deserialize, Clone)]
struct ChunkInput {
    id: u64,
    chapter_id: String,
    chapter_title: String,
    volume_index: usize,
    chapter_index: usize,
    volume_title: String,
    text: String,
    vector: Vec<f32>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ChunkMeta {
    key: u64,
    chapter_id: String,
    chapter_title: String,
    volume_index: usize,
    chapter_index: usize,
    volume_title: String,
    text: String,
}

#[derive(Serialize, Deserialize)]
struct RagStore {
    dim: usize,
    metric: String,
    method: String, // "semantic" | "lexical"
    novel_id: String,
    built_at: u64,
    chunk_count: usize,
    chapter_count: usize,
    keys: Vec<u64>,
    vecs: Vec<Vec<f32>>,
    metas: Vec<ChunkMeta>,
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn rag_base_dir(app: &AppHandle) -> PathBuf {
    match app.path().app_data_dir() {
        Ok(dir) => dir.join("fx_rag"),
        Err(_) => std::env::temp_dir().join("fuxiloom_rag"),
    }
}

/// 文件名安全化（与 NMM/因果图同款），避免 novel_id 含路径分隔符。
fn safe_name(novel_id: &str) -> String {
    let mut s = String::new();
    for c in novel_id.chars() {
        if c.is_alphanumeric() || c == '-' || c == '_' {
            s.push(c);
        } else {
            s.push('_');
        }
    }
    if s.is_empty() {
        s.push_str("nov");
    }
    s
}

fn store_path(app: &AppHandle, novel_id: &str) -> PathBuf {
    rag_base_dir(app).join(format!("{}.json", safe_name(novel_id)))
}

/// 余弦相似度（真正按模长归一化计算，对「已归一化 / 未归一化」输入都鲁棒）。
/// 语义嵌入（bge-m3 等）提供方返回向量未必 L2 归一化，故显式除以模长积，避免分数失真。
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    let mut dot = 0.0f32;
    let mut na = 0.0f32;
    let mut nb = 0.0f32;
    for i in 0..n {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    let norm = (na * nb).sqrt();
    if norm <= 0.0 {
        0.0
    } else {
        dot / norm
    }
}

/// 纯函数召回排序：对全库向量按余弦降序，跳过 exclude 命中的下标。
/// 返回全量排序（不截断），由调用方（select_diverse_hits）做阈值过滤 + 多样性截断。
/// 抽成纯函数便于单测（无需 AppHandle/文件系统）。
pub fn rank_by_cosine(
    vecs: &[Vec<f32>],
    query: &[f32],
    exclude: &dyn Fn(usize) -> bool,
) -> Vec<(usize, f32)> {
    let mut scored: Vec<(usize, f32)> = vecs
        .iter()
        .enumerate()
        .filter(|(i, _)| !exclude(*i))
        .map(|(i, v)| (i, cosine(query, v)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored
}

/// 从已排序召回中做「阈值过滤 + 每章上限 + Top-K 截断」的多样性选择：
/// 按分数降序遍历，低于 min_score 的直接丢弃（低分噪声不占 topK 槽位，防止
/// 前端过滤时真相关块已被挤掉）；同一章最多 max_per_chapter 块（防一章刷屏、
/// 保证 topK 覆盖更多前情章）。返回选中的 (下标, 分数) 列表。
pub fn select_diverse_hits(
    ranked: &[(usize, f32)],
    chapter_of: &dyn Fn(usize) -> Option<String>,
    min_score: f32,
    max_per_chapter: Option<usize>,
    top_k: usize,
) -> Vec<(usize, f32)> {
    let mut out: Vec<(usize, f32)> = Vec::new();
    let mut per_chapter: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for &(i, s) in ranked {
        if out.len() >= top_k {
            break;
        }
        if s < min_score {
            // 已排序 → 后续分数只会更低，直接终止
            break;
        }
        if let Some(cap) = max_per_chapter {
            if let Some(cid) = chapter_of(i) {
                let n = per_chapter.entry(cid).or_insert(0);
                if *n >= cap {
                    continue;
                }
                *n += 1;
            }
        }
        out.push((i, s));
    }
    out
}

// ─── 命令 ───

/// 构建/重建某小说的向量索引。
/// payload_json = { dim, metric, method, chunks: ChunkInput[] }（前端把全卷章节切块 + 向量化后传入）。
#[tauri::command]
pub fn wx_rag_index_build(app: AppHandle, novel_id: String, payload_json: String) -> String {
    let payload: BuildPayload = match serde_json::from_str(&payload_json) {
        Ok(p) => p,
        Err(e) => {
            return json!({ "ok": false, "error": format!("payload 解析失败: {}", e) }).to_string();
        }
    };
    if payload.dim == 0 {
        return json!({ "ok": false, "error": "dim 不能为 0" }).to_string();
    }
    if payload.chunks.is_empty() {
        return json!({ "ok": false, "error": "chunks 为空" }).to_string();
    }

    let dir = rag_base_dir(&app);
    if let Err(e) = fs::create_dir_all(&dir) {
        return json!({ "ok": false, "error": format!("建目录失败: {}", e) }).to_string();
    }
    let path = store_path(&app, &novel_id);

    let mut keys: Vec<u64> = Vec::new();
    let mut vecs: Vec<Vec<f32>> = Vec::new();
    let mut metas: Vec<ChunkMeta> = Vec::new();
    let mut chapter_ids: HashSet<String> = HashSet::new();

    for ch in &payload.chunks {
        if ch.text.trim().is_empty() {
            continue;
        }
        if ch.vector.len() != payload.dim {
            return json!({
                "ok": false,
                "error": format!("向量维度不符：期望 {}，实际 {}", payload.dim, ch.vector.len())
            })
            .to_string();
        }
        chapter_ids.insert(ch.chapter_id.clone());
        keys.push(ch.id);
        vecs.push(ch.vector.clone());
        metas.push(ChunkMeta {
            key: ch.id,
            chapter_id: ch.chapter_id.clone(),
            chapter_title: ch.chapter_title.clone(),
            volume_index: ch.volume_index,
            chapter_index: ch.chapter_index,
            volume_title: ch.volume_title.clone(),
            text: ch.text.clone(),
        });
    }

    if metas.is_empty() {
        return json!({ "ok": false, "error": "有效切块为空（章节均无正文）" }).to_string();
    }

    let store = RagStore {
        dim: payload.dim,
        metric: payload.metric,
        method: payload.method,
        novel_id: novel_id.clone(),
        built_at: now_ms(),
        chunk_count: metas.len(),
        chapter_count: chapter_ids.len(),
        keys,
        vecs,
        metas,
    };

    match fs::write(&path, serde_json::to_string(&store).unwrap_or_default()) {
        Ok(_) => json!({
            "ok": true,
            "chunk_count": store.chunk_count,
            "chapter_count": store.chapter_count,
            "dim": store.dim,
            "method": store.method,
        })
        .to_string(),
        Err(e) => json!({ "ok": false, "error": format!("写入失败: {}", e) }).to_string(),
    }
}

#[derive(Deserialize)]
struct BuildPayload {
    dim: usize,
    metric: String,
    method: String,
    chunks: Vec<ChunkInput>,
}

/// 召回前情：按 query 向量余弦相似度返回 Top-K 片段，过滤掉当前章自身。
/// query_json = { "vector": number[] }（由前端用与建索引一致的方法计算）。
/// min_score：最低相似度阈值（低分噪声不占 topK 槽位）；max_per_chapter：每章最多命中块数（保多样性）。
#[tauri::command]
pub fn wx_rag_recall(
    app: AppHandle,
    novel_id: String,
    query_json: String,
    top_k: usize,
    exclude_chapter_id: Option<String>,
    min_score: Option<f32>,
    max_per_chapter: Option<usize>,
) -> String {
    let path = store_path(&app, &novel_id);
    let data = match fs::read_to_string(&path) {
        Ok(d) => d,
        Err(_) => return json!({ "built": false, "results": [] }).to_string(),
    };
    let store: RagStore = match serde_json::from_str(&data) {
        Ok(s) => s,
        Err(_) => return json!({ "built": false, "results": [] }).to_string(),
    };
    if store.chunk_count == 0 {
        return json!({ "built": true, "results": [] }).to_string();
    }

    let parsed_q: Value = match serde_json::from_str(&query_json) {
        Ok(v) => v,
        Err(e) => {
            return json!({ "built": false, "error": format!("query 解析失败: {}", e) }).to_string();
        }
    };
    let q_arr = match parsed_q.get("vector").and_then(|v| v.as_array()) {
        Some(a) => a,
        None => return json!({ "built": false, "error": "query 缺少 vector 字段" }).to_string(),
    };
    let query: Vec<f32> = q_arr.iter().filter_map(|x| x.as_f64().map(|f| f as f32)).collect();
    if query.len() != store.dim {
        // 维度不符（多半是嵌入方法切换后旧索引未重建）→ 提示重建，不返回脏结果
        return json!({
            "built": false,
            "reason": "dim_mismatch",
            "expected_dim": store.dim,
            "got_dim": query.len(),
        })
        .to_string();
    }

    let exclude = |i: usize| -> bool {
        if let Some(ex) = &exclude_chapter_id {
            store.metas[i].chapter_id == *ex
        } else {
            false
        }
    };
    let chapter_of = |i: usize| -> Option<String> {
        Some(store.metas.get(i)?.chapter_id.clone())
    };
    let ranked = rank_by_cosine(&store.vecs, &query, &exclude);
    let selected = select_diverse_hits(
        &ranked,
        &chapter_of,
        min_score.unwrap_or(0.0),
        max_per_chapter,
        top_k,
    );

    let mut results: Vec<Value> = Vec::new();
    for (i, sim) in selected {
        let m = &store.metas[i];
        results.push(json!({
            "chapter_id": m.chapter_id,
            "chapter_title": m.chapter_title,
            "volume_index": m.volume_index,
            "chapter_index": m.chapter_index,
            "volume_title": m.volume_title,
            "text": m.text,
            "score": sim,
        }));
    }
    json!({ "built": true, "results": results }).to_string()
}

/// 索引状态（前端据此决定是否需先构建 / 方法是否一致）。
#[tauri::command]
pub fn wx_rag_status(app: AppHandle, novel_id: String) -> String {
    let path = store_path(&app, &novel_id);
    match fs::read_to_string(&path) {
        Ok(d) => match serde_json::from_str::<RagStore>(&d) {
            Ok(s) => json!({
                "built": s.chunk_count > 0,
                "chunk_count": s.chunk_count,
                "chapter_count": s.chapter_count,
                "dim": s.dim,
                "method": s.method,
            })
            .to_string(),
            Err(_) => json!({ "built": false, "chunk_count": 0, "chapter_count": 0, "dim": 0, "method": "" }).to_string(),
        },
        Err(_) => json!({ "built": false, "chunk_count": 0, "chapter_count": 0, "dim": 0, "method": "" }).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v3(a: f32, b: f32, c: f32) -> Vec<f32> {
        vec![a, b, c]
    }

    #[test]
    fn rank_returns_nearest_first_and_excludes() {
        let vecs = vec![
            v3(1.0, 0.0, 0.0), // 0: 指向 x
            v3(0.0, 1.0, 0.0), // 1: 指向 y
            v3(0.0, 0.0, 1.0), // 2: 指向 z
        ];
        // 查询接近 x 轴 → 0 应排第一
        let ranked = rank_by_cosine(&vecs, &v3(0.9, 0.1, 0.0), &(|_| false));
        assert_eq!(ranked[0].0, 0);
        assert!(ranked[0].1 > ranked[1].1);
        // 排除下标 0 → 第一变 1
        let ranked2 = rank_by_cosine(&vecs, &v3(0.9, 0.1, 0.0), &(|i| i == 0));
        assert_eq!(ranked2[0].0, 1);
    }

    #[test]
    fn identical_vector_ranks_self_at_top_with_score_one() {
        let vecs = vec![v3(0.577, 0.577, 0.577), v3(1.0, 0.0, 0.0), v3(0.0, 1.0, 0.0)];
        let q = v3(0.577, 0.577, 0.577);
        let ranked = rank_by_cosine(&vecs, &q, &(|_| false));
        assert_eq!(ranked[0].0, 0);
        assert!((ranked[0].1 - 1.0).abs() < 1e-3);
    }

    #[test]
    fn select_diverse_hits_filters_low_score_and_caps_per_chapter() {
        // 已排序召回：(0, 0.9) c_a、(1, 0.85) c_a、(2, 0.6) c_b、(3, 0.5) c_c、(4, 0.1) 噪声
        let ranked = vec![(0usize, 0.9f32), (1, 0.85), (2, 0.6), (3, 0.5), (4, 0.1)];
        let chapter_of = |i: usize| -> Option<String> {
            Some(match i {
                0 | 1 => "c_a".to_string(),
                2 => "c_b".to_string(),
                3 => "c_c".to_string(),
                _ => "c_x".to_string(),
            })
        };
        // 阈值 0.2 + 每章 1 块 + topK 5 → c_a 只留最高分，噪声 0.1 被滤，覆盖 3 章
        let sel = select_diverse_hits(&ranked, &chapter_of, 0.2, Some(1), 5);
        let idxs: Vec<usize> = sel.iter().map(|(i, _)| *i).collect();
        assert_eq!(idxs, vec![0, 2, 3]);
        // 每章 2 块 → c_a 两块都进
        let sel2 = select_diverse_hits(&ranked, &chapter_of, 0.2, Some(2), 5);
        let idxs2: Vec<usize> = sel2.iter().map(|(i, _)| *i).collect();
        assert_eq!(idxs2, vec![0, 1, 2, 3]);
        // topK=2 → 只取前 2
        let sel3 = select_diverse_hits(&ranked, &chapter_of, 0.0, None, 2);
        assert_eq!(sel3.len(), 2);
        // 阈值 0.95 → 全滤空
        let sel4 = select_diverse_hits(&ranked, &chapter_of, 0.95, None, 5);
        assert!(sel4.is_empty());
        // 无 chapter_of（None）→ 不按章 cap，纯 topK
        let sel5 = select_diverse_hits(&ranked, &(|_| None), 0.2, Some(1), 5);
        assert_eq!(sel5.len(), 4); // 0.1 噪声被阈值滤掉，其余全进
    }
}
