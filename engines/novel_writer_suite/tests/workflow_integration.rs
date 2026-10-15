//! 集成测试 - 模拟完整写作流程
//!
//! 测试：创建世界 → 添加卷快照 → 时间线 → 角色弧光 → 伏笔 → 注入上下文

use novel_writer_suite::longform::*;

#[test]
fn test_complete_writing_workflow() {
    println!("\n=== 测试完整写作流程 ===\n");
    
    let novel_id = "test_novel";
    let mut ctx = LongFormContext::new();
    
    // Step 1: 创建第1卷快照
    println!("Step 1: 创建卷快照...");
    let mut vol1 = VolumeSnapshot::new(1, "初入江湖");
    vol1.set_summary("主角离开家乡，踏上修仙之路。在宗门考核中展露天赋，被长老收为弟子。");
    vol1.chapter_range = (1, 30);
    ctx.add_volume(vol1);
    assert_eq!(ctx.volumes.len(), 1);
    println!("  ✅ 第1卷创建成功");
    
    // Step 2: 添加时间线事件
    println!("\nStep 2: 添加时间线...");
    ctx.timeline.add_event(1, 1, "主角离开家乡");
    ctx.timeline.add_event(3, 5, "到达宗门");
    ctx.timeline.add_event(7, 10, "通过入门考核");
    ctx.timeline.add_event(15, 20, "被长老收为弟子");
    assert_eq!(ctx.timeline.event_count(), 4);
    println!("  ✅ 时间线事件: 4个");
    
    // Step 3: 创建角色弧光
    println!("\nStep 3: 创建角色弧光...");
    let mut arc = CharacterArc::new("主角");
    arc.add_stage(ArcStage {
        name: "平凡少年".to_string(),
        start_chapter: 1,
        end_chapter: 10,
        expected_power_level: Some("凡人".to_string()),
        expected_emotional_state: Some("懵懂".to_string()),
        expected_relationships: vec![],
        goal: "踏上修仙路".to_string(),
    });
    arc.add_stage(ArcStage {
        name: "初入宗门".to_string(),
        start_chapter: 11,
        end_chapter: 30,
        expected_power_level: Some("练气期".to_string()),
        expected_emotional_state: Some("谨慎".to_string()),
        expected_relationships: vec!["师兄弟".to_string()],
        goal: "在宗门站稳脚跟".to_string(),
    });
    ctx.character_arcs.insert("主角".to_string(), arc);
    println!("  ✅ 角色弧光: 2个阶段");
    
    // Step 4: 埋设伏笔
    println!("\nStep 4: 埋设伏笔...");
    ctx.arc_tracker.add_foreshadowing(Foreshadowing {
        id: "f1".to_string(),
        description: "神秘老者留下的玉佩".to_string(),
        planted_chapter: 1,
        expected_payoff: Some(20),
        resolved: false,
        resolved_chapter: None,
    });
    ctx.arc_tracker.add_foreshadowing(Foreshadowing {
        id: "f2".to_string(),
        description: "主角体内的隐藏血脉".to_string(),
        planted_chapter: 5,
        expected_payoff: Some(50),
        resolved: false,
        resolved_chapter: None,
    });
    assert_eq!(ctx.arc_tracker.foreshadowings.len(), 2);
    println!("  ✅ 伏笔: 2个");
    
    // Step 5: 推进到第15章，观察角色状态
    println!("\nStep 5: 推进到第15章...");
    ctx.arc_tracker.current_chapter = 15;
    
    // 检查即将到期的伏笔
    let upcoming = ctx.arc_tracker.check_upcoming_payoffs(10);
    assert_eq!(upcoming.len(), 1); // 玉佩伏笔应该到期了
    println!("  ✅ 即将到期伏笔: {}", upcoming.len());
    println!("     - {}", upcoming[0].description);
    
    // Step 6: 生成注入上下文
    println!("\nStep 6: 生成注入上下文...");
    let injection = ctx.build_injection_context();
    println!("  注入上下文长度: {} 字符", injection.len());
    println!("\n--- 注入内容 ---");
    println!("{}", injection);
    println!("--- 结束 ---\n");
    
    // 验证注入内容包含关键信息
    assert!(injection.contains("初入江湖"));
    assert!(injection.contains("时间线"));
    assert!(injection.contains("角色成长弧"));
    assert!(injection.contains("伏笔"));
    println!("  ✅ 注入上下文包含所有关键信息");
    
    // Step 7: 诊断报告
    println!("\nStep 7: 生成诊断报告...");
    let report = ctx.diagnostic_report();
    println!("  卷数: {}", report.volume_count);
    println!("  时间线事件: {}", report.timeline_event_count);
    println!("  角色弧光: {}", report.character_arc_count);
    println!("  伏笔总数: {}", report.foreshadowing_report.total);
    println!("  伏笔已回收: {}", report.foreshadowing_report.resolved);
    println!("  伏笔回收率: {:.1}%", report.foreshadowing_report.resolution_rate * 100.0);
    println!("  过期伏笔: {}", report.foreshadowing_report.overdue);
    println!("  即将到期: {}", report.foreshadowing_report.upcoming);
    
    println!("\n=== 测试完成 ===");
    println!("\n✅ 所有步骤通过");
}
