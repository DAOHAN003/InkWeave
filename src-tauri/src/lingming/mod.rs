//! 灵明模块 - wanxiang_engines 的 thin wrapper
//!
//! 本模块现在是对 wanxiang_engines workspace 的 thin wrapper：
//! - 直觉脑 → novel_writer_suite::CreativeEngine（跨域概念图 + 扩散激活）
//! - 进化引擎 → lingming_core::pareto_front + 最小内联进化状态
//! - 写作记忆 → memory_core::NmmUnified（SDR 编码 + 融合检索）
//! - 事件总线 → lingming_com::MessageBus（环形缓冲区 + do-calculus 预演）
//!
//! 旧的 4 个自实现文件（intuition_brain / evolution_engine / writing_memory / event_bus）
//! 已删除，消除与 wanxiang_engines 的重复实现。
//! 13 个 #[tauri::command] 的签名和返回 JSON 格式保持不变（前端兼容）。

pub mod commands;
