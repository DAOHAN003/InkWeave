//! # Web 编年史看板（P2-3 · 产出层）
//!
//! 把 `world_export` 的通用 JSON 数据**内联**进一个自包含的 `index.html`，
//! 双击即可在浏览器打开，**无需静态服务器**（数据随页面一起加载）。
//! 同时写出 P2-2 的 8 份 JSON，供离线复用 / 二次分析。
//!
//! ## 设计铁律：不得硬绑定世界模板
//! 看板 HTML 只消费 `WorldExport` 的**通用形状**——势力名、事件描述、时代分桶、
//! 守恒四池等字段都是数据驱动的；JS 里**绝无任何 `if (world_type === Xianxia)`
//! 之类的题材分支**，也不对具体技艺/势力名写死样式。无论产出仙侠/科幻/都市，
//! 看板渲染逻辑完全一致，仅展示数据不同。这与 P2-2 的"不绑定模板"纪律一脉相承。

use std::fs;
use std::path::Path;
use crate::export::{world_export, write_world_export};
use crate::simulator::WorldSimulator;
use crate::economy::calibrate_economy;
use crate::scan::{scan_rule_parameters, default_scan_params};

/// HTML 模板（编译期嵌入）。`/*__WORLD_JSON__*/` 占位符会被实际 JSON 替换。
const TEMPLATE: &str = include_str!("../templates/dashboard.html");

/// World Lab 模板（观赏 + 经济标定 + 实验三合一）。三个占位符分别内联
/// 世界数据 / 经济指标 / 扫描矩阵。
const LAB_TEMPLATE: &str = include_str!("../templates/world_lab.html");

/// 把世界状态写入 `dir`：先写 8 份通用 JSON（P2-2），再写自包含 `index.html` 看板。
/// 纯导出、确定性（同 seed → index.html + 8 JSON 逐字节一致）。
pub fn write_dashboard(dir: &str, sim: &WorldSimulator) -> std::io::Result<()> {
    // 1) 8 份通用 JSON（数据驱动、不绑定模板）
    write_world_export(dir, sim)?;

    // 2) 内联数据的自包含看板
    let export = world_export(sim);
    let json = serde_json::to_string(&export)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    // 防止事件描述中的 `<` 破坏 <script> 块（JSON 合法转义，不影响数据）
    let safe = json.replace('<', "\\u003c");
    let html = TEMPLATE.replace("/*__WORLD_JSON__*/", &safe);

    let path = Path::new(dir);
    fs::create_dir_all(path)?;
    fs::write(path.join("index.html"), html)?;
    Ok(())
}

/// 把世界写入 **World Lab** 自包含看板（观赏 + 经济标定 + 实验三合一）：
/// 8 份通用 JSON + `economy.json` + `scan.json` + `index.html`。
///
/// - 观赏区：文明时间线 / 势力兴衰 / 事件流 / 守恒律（复用 P2-3 看板逻辑）。
/// - 经济标定区：贸易密度 / 互惠度 / 财富基尼 / 经济活跃度（`calibrate_economy`）。
/// - 实验区：规则参数扫描矩阵（`scan_rule_parameters`，what-if 仪器）。
///
/// 纯导出、确定性（同 seed → 逐字节一致）；不绑定世界模板。
/// `scan_ticks` 控制扫描矩阵每变体跑多少 tick（越大越准但越慢）。
pub fn write_world_lab(dir: &str, sim: &WorldSimulator, scan_ticks: u64) -> std::io::Result<()> {
    let path = Path::new(dir);
    fs::create_dir_all(path)?;

    // 1) 8 份通用 JSON
    write_world_export(dir, sim)?;

    // 2) 经济标定
    let economy = calibrate_economy(sim);
    let econ_json = serde_json::to_string_pretty(&economy)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(path.join("economy.json"), econ_json)?;

    // 3) 实验区：规则参数扫描矩阵（确定性重放，零 rng）
    let base = sim.rules.rules.clone();
    let params = default_scan_params(&base);
    let scan = scan_rule_parameters(sim.seed, scan_ticks, &base, &params);
    let scan_json = serde_json::to_string_pretty(&scan)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    fs::write(path.join("scan.json"), scan_json)?;

    // 4) 内联三份数据进自包含 HTML
    let export = world_export(sim);
    let w = serde_json::to_string(&export)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let e = serde_json::to_string(&economy)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let s = serde_json::to_string(&scan)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let safe = |j: String| j.replace('<', "\\u003c");
    let html = LAB_TEMPLATE
        .replace("/*__WORLD_JSON__*/", &safe(w))
        .replace("/*__ECONOMY_JSON__*/", &safe(e))
        .replace("/*__SCAN_JSON__*/", &safe(s));
    fs::write(path.join("index.html"), html)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use wanxiang_types::{WorldRules, WorldType};

    fn build(seed: u64, wt: WorldType) -> WorldSimulator {
        let mut r = WorldRules::default();
        r.world_type = wt;
        WorldSimulator::new_with_seed(r, seed)
    }

    #[test]
    fn write_dashboard_creates_index_and_8_json() {
        let sim = build(42, WorldType::Xianxia);
        let dir = std::env::temp_dir().join("wanxiang_dash_test");
        let _ = fs::remove_dir_all(&dir);
        write_dashboard(dir.to_str().unwrap(), &sim).unwrap();
        let p = dir.join("index.html");
        assert!(p.exists(), "缺少 index.html");
        let txt = fs::read_to_string(&p).unwrap();
        // 内联了数据占位符已被替换（不再含占位符）
        assert!(!txt.contains("/*__WORLD_JSON__*/"), "占位符应已被替换");
        assert!(txt.contains("\"meta\""), "应内联 WORLD 数据（含 meta）");
        for f in ["entities.json", "factions.json", "events.json", "eras.json",
                  "skills.json", "wars.json", "resources.json", "rules.json"] {
            assert!(dir.join(f).exists(), "缺少导出文件 {}", f);
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dashboard_is_template_agnostic_and_deterministic() {
        // 仙侠 vs 科幻：两份 index.html 除世界数据取值外，渲染骨架一致；
        // 且同 seed 两次生成逐字节一致（跨进程确定性）。
        let sx = build(7, WorldType::Xianxia);
        let ss = build(7, WorldType::Scifi);
        let dx = std::env::temp_dir().join("wanxiang_dash_x");
        let ds = std::env::temp_dir().join("wanxiang_dash_s");
        let _ = fs::remove_dir_all(&dx); let _ = fs::remove_dir_all(&ds);
        write_dashboard(dx.to_str().unwrap(), &sx).unwrap();
        write_dashboard(ds.to_str().unwrap(), &ss).unwrap();

        let hx = fs::read_to_string(dx.join("index.html")).unwrap();
        let hs = fs::read_to_string(ds.join("index.html")).unwrap();
        // 渲染骨架（模板部分）一致：内联 JSON 之前的部分（HTML 头 + JS 逻辑）必须完全相同，
        // 与题材取值无关——这才是"不绑定世界模板"的真正不变量。
        let skel_hx = hx.split("const W = ").next().unwrap();
        let skel_hs = hs.split("const W = ").next().unwrap();
        assert_eq!(skel_hx, skel_hs, "看板渲染骨架必须跨世界类型一致（模板无关）");
        // 内联数据确实不同（题材取值不同）
        assert_ne!(hx, hs, "不同题材内联数据应不同");

        // 确定性：同 seed 两次逐字节一致
        let a = std::env::temp_dir().join("wanxiang_dash_det_a");
        let b = std::env::temp_dir().join("wanxiang_dash_det_b");
        let _ = fs::remove_dir_all(&a); let _ = fs::remove_dir_all(&b);
        let same = build(7, WorldType::Xianxia);
        write_dashboard(a.to_str().unwrap(), &same).unwrap();
        let same2 = build(7, WorldType::Xianxia);
        write_dashboard(b.to_str().unwrap(), &same2).unwrap();
        assert_eq!(
            fs::read_to_string(a.join("index.html")).unwrap(),
            fs::read_to_string(b.join("index.html")).unwrap(),
            "同 seed 看板必须逐字节一致"
        );
        let _ = fs::remove_dir_all(&dx); let _ = fs::remove_dir_all(&ds);
        let _ = fs::remove_dir_all(&a); let _ = fs::remove_dir_all(&b);
    }

    #[test]
    fn write_world_lab_creates_full_lab() {
        let mut sim = build(42, WorldType::Xianxia);
        sim.run_ticks(30);
        let dir = std::env::temp_dir().join("wanxiang_lab_test");
        let _ = fs::remove_dir_all(&dir);
        write_world_lab(dir.to_str().unwrap(), &sim, 20).unwrap();
        // index.html + economy.json + scan.json + 8 份通用 JSON
        assert!(dir.join("index.html").exists(), "缺少 index.html");
        assert!(dir.join("economy.json").exists(), "缺少 economy.json");
        assert!(dir.join("scan.json").exists(), "缺少 scan.json");
        for f in ["entities.json", "factions.json", "events.json", "eras.json",
                  "skills.json", "wars.json", "resources.json", "rules.json"] {
            assert!(dir.join(f).exists(), "缺少导出文件 {}", f);
        }
        let html = fs::read_to_string(dir.join("index.html")).unwrap();
        assert!(!html.contains("/*__WORLD_JSON__*/"), "WORLD 占位符未替换");
        assert!(!html.contains("/*__ECONOMY_JSON__*/"), "ECONOMY 占位符未替换");
        assert!(!html.contains("/*__SCAN_JSON__*/"), "SCAN 占位符未替换");
        assert!(html.contains("经济标定"), "应有经济标定区");
        assert!(html.contains("扫描矩阵"), "应有实验区");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn world_lab_is_deterministic() {
        // 同 seed 两次生成 World Lab 逐字节一致（跨进程确定性）
        let mk = || {
            let mut s = build(7, WorldType::Xianxia);
            s.run_ticks(25);
            s
        };
        let a = std::env::temp_dir().join("wanxiang_lab_det_a");
        let b = std::env::temp_dir().join("wanxiang_lab_det_b");
        let _ = fs::remove_dir_all(&a); let _ = fs::remove_dir_all(&b);
        write_world_lab(a.to_str().unwrap(), &mk(), 15).unwrap();
        write_world_lab(b.to_str().unwrap(), &mk(), 15).unwrap();
        assert_eq!(
            fs::read_to_string(a.join("index.html")).unwrap(),
            fs::read_to_string(b.join("index.html")).unwrap(),
            "同 seed World Lab 必须逐字节一致"
        );
        assert_eq!(
            fs::read_to_string(a.join("economy.json")).unwrap(),
            fs::read_to_string(b.join("economy.json")).unwrap(),
            "同 seed economy.json 必须一致"
        );
        let _ = fs::remove_dir_all(&a); let _ = fs::remove_dir_all(&b);
    }
}
