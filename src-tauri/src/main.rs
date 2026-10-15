#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use tauri::Manager;

// 灵明（lingming）内核层模块：直觉脑 / 进化引擎 / 写作记忆 / 事件总线。
//
// 2026-09-16 定位边界决策：**刻意不进产品主 bridge**。
// 12 个命令在生产前端零引用，属内核层能力而非产品出口——按架构铁律
// 「可保留为独立可选模块但不得进写稿主循环」处理：代码与测试完整保留，
// 需要时按 docs/定位边界守则.md 的豁免流程再暴露给产品。
mod wanxiang_bridge;
mod local_inference;
mod rag;
mod backup_commands;
mod chapter_store;
mod log_commands;
mod credential_vault;

use wanxiang_bridge::*;
use rag::*;
use local_inference::*;
use backup_commands::*;
use chapter_store::*;
use log_commands::*;
use credential_vault::*;

fn main() {
  // 生成上下文（v2：app_data_dir 需 app 实例，崩溃日志安装挪进 setup 钩子）
  let context = tauri::generate_context!();

  #[cfg(target_os = "windows")]
  unsafe {
    use windows_sys::Win32::UI::HiDpi::{
      SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  }

  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_shell::init())
    .manage(LocalInferenceState::new())
    .setup(|app| {
      // 全局崩溃日志：把 Rust 端 panic 落盘到 logs/panic.log
      // （v2 迁移：app_data_dir 需要 app 实例，从 main 顶部挪到此钩子）
      let app_data = app.path().app_data_dir().unwrap_or_default();
      log_commands::install_crash_logger(app_data);

      #[cfg(target_os = "windows")]
      {
        if let Some(window) = app.get_webview_window("main") {
          let _ = window.with_webview(|webview| unsafe {
            let _ = webview.controller().SetZoomFactor(1.0);
          });

          if let Ok(size) = window.inner_size() {
            let _ = window.set_size(tauri::Size::Physical(size));
          }
        }
      }

      // 调试开关：通过环境变量 TAURI_OPEN_DEVTOOLS=1 在生产模式下也开 devtools
      #[cfg(target_os = "windows")]
      if std::env::var("TAURI_OPEN_DEVTOOLS").ok().as_deref() == Some("1") {
        if let Some(window) = app.get_webview_window("main") {
          window.open_devtools();
        }
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      // ─── 灵明（lingming）12 命令已于 2026-09-16 剥离出产品主 bridge ───
      // 原因：前端零引用，属内核层能力而非产品出口。
      // 代码保留在 mod lingming，需要时按 docs/定位边界守则.md 的豁免流程再暴露。
      // ─── L7 万象引擎桥接命令 ───
      wx_deterministic_id,
      wx_fnv1a32,
      wx_causal_graph_new,
      wx_causal_graph_add_node,
      wx_causal_graph_add_edge,
      wx_causal_graph_intervene,
      wx_causal_graph_stats,
      wx_causal_graph_get,
      wx_causal_verify_text,
      wx_causal_verify_claim,
      wx_causal_graph_open,
      wx_causal_graph_reset,
      wx_evolution_should_evolve,
      wx_evolution_pareto_front,
      wx_nmm_new,
      wx_nmm_store,
      wx_nmm_retrieve,
      wx_nmm_save,
      wx_nmm_load,
      wx_pdca_new,
      wx_pdca_cycle,
      wx_emotion_meta_new,
      wx_emotion_meta_reflect,
      // ─── L4 SkillManager 桥接命令 ───
      wx_skill_load_dir,
      wx_skill_list,
      wx_skill_get,
      wx_skill_match,
      wx_skill_semantic_search,
      wx_skill_check_prerequisites,
      wx_llm_backoff_delay,
      wx_llm_retry_success_probability,
      wx_llm_estimate_tokens,
      wx_llm_system_reliability,
      wx_llm_vision_token_count,
      wx_llm_image_cost,
      wx_llm_cross_attention_flops,
      wx_novel_brainstorm,
      wx_novel_intuition_status,
      wx_novel_world_add_fact,
      wx_novel_world_facts,
      wx_novel_world_causal_effect,
      wx_novel_gate_check_chapter,
      wx_novel_world_save,
      wx_novel_world_load,
      wx_novel_ooc_estimate_consistency,
      wx_novel_pipeline_run,
      wx_novel_status,
      wx_canonical_outline_consistency_check,
      wx_outline_quality_check,
      wx_ai_flavored_lint,
      // ─── 长篇前情 RAG（usearch 式向量召回，确定性离线词向量）───
      wx_rag_index_build,
      wx_rag_recall,
      wx_rag_status,
      // ─── L8 安全+配置桥接命令 ───
      wx_security_scan_text,
      wx_security_classify_risk,
      wx_security_sandbox_normalize_path,
      wx_security_sandbox_detect_traversal,
      wx_security_sandbox_new,
      wx_security_sandbox_configure,
      wx_security_sandbox_check,
      wx_security_sandbox_violations,
      wx_security_pii_detect,
      wx_security_pii_mask,
      wx_security_privacy_info_leaked,
      wx_security_privacy_dp,
      wx_security_csp_check_injection,
      wx_security_csp_sanitize,
      wx_security_csp_escape_html,
      wx_security_csp_block_rate,
      wx_security_audit_new,
      wx_security_audit_log,
      wx_security_audit_verify,
      wx_security_audit_export,
      wx_security_audit_len,
      wx_security_threat_risk,
      wx_security_threat_system_risk,
      wx_security_threat_default,
      wx_security_threat_assess,
      wx_security_defense_breach_probability,
      wx_security_defense_block_probability,
      wx_security_red_team_run,
      wx_security_guard_new,
      wx_security_guard_configure_agent,
      wx_security_guard_check_action,
      wx_config_supported_providers,
      wx_config_env_key_for,
      wx_config_default_url_for,
      wx_config_default_model_for,
      wx_config_resolve_llm,
      wx_config_resolve_source,
      wx_config_coverage_fault_tolerance,
      wx_config_separated_leak_risk,
      wx_config_combined_leak_risk,
      wx_config_load_str,
      wx_config_load_file,
      wx_config_load_and_validate,
      wx_config_get,
      wx_config_known_keys,
      // ─── L6 longform 百万字长篇支撑 ───
      wx_longform_add_volume,
      wx_longform_add_timeline_event,
      wx_longform_add_character_arc,
      wx_longform_observe_character,
      wx_longform_add_foreshadowing,
      wx_longform_resolve_foreshadowing,
      wx_longform_check_overdue_foreshadowings,
      wx_longform_build_injection,
      wx_longform_diagnostic,
      // ─── P1-B 本地推理 sidecar ───
      start_local_inference,
      stop_local_inference,
      local_inference_status,
      // ─── P2 EPUB 导出：已于 2026-09-16 移除 Rust pandoc sidecar 命令 ───
      // EPUB 导出改由纯 JS 实现（src/engines/wanxiang/epubJs.ts，不依赖外部二进制），
      // UI 入口见 src/components/Modals/EpubExportPanel.tsx。原 export_epub 零调用，已归档。
      // ─── 数据安全：文件级备份/恢复 ───
      wx_backup_save,
      wx_backup_list,
      wx_backup_restore,
      // ─── 章节正文外置（解决 localStorage 配额硬伤）───
      wx_chapter_store_save,
      wx_chapter_store_load,
      wx_chapter_store_delete,
      // ─── 统一日志：崩溃捕获 + 日志面板 ───
      wx_log_write,
      wx_log_read,
      // ─── API Key：Windows Credential Manager 安全存储 ───
      wx_secret_get,
      wx_secret_set,
      wx_secret_delete
    ])
    .run(context)
    .expect("error while building tauri application");
}
