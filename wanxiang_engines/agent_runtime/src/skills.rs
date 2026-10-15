//! 技能系统 — SkillManager + TF-IDF 关键词匹配 + 前置条件检查
//!
//! 实现依据：`内部技术文档 · 10_openagent技术\10_技能系统\技能系统.md`
//!
//! 核心数据结构：
//! - [`SkillPrerequisites`]：前置条件（env_vars/commands）
//! - [`SkillMetadata`]：技能元数据（name/description/version/author/tags/trigger_keywords/...）
//! - [`Skill`]：技能（metadata + content + path）
//! - [`PrereqCheckResult`]：前置条件检查结果（satisfied/issues）
//! - [`SkillManager`]：技能管理器（register/get/list_all/match/semantic_search/check_prerequisites）
//!
//! 关键算法（数学公式）：
//! - **TF-IDF 余弦相似度**：Score(skill, query) = cos(TF-IDF(query), TF-IDF(skill.keywords))
//!   TF-IDF(term, query) = TF(term, query) × log(N/DF(term))
//! - **前置条件可用概率**：P(可用) = ∏ P(req_i)（独立假设下的连乘）
//! - **关键词匹配**：trigger_keywords 命中 +1 分，tags 命中 +0.5 分
//! - **惰性初始化**：启动仅加载元数据，匹配时加载内容（内存 N×1KB + active×10KB）

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ──────────────────────── 数据结构 ────────────────────────

/// 技能前置条件 — 对照规格 §SkillPrerequisites @dataclass
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillPrerequisites {
    /// 需要的环境变量
    pub env_vars: Vec<String>,
    /// 需要的命令
    pub commands: Vec<String>,
}

/// 技能元数据 — 对照规格 §SkillMetadata @dataclass
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    pub version: String,
    pub author: String,
    pub tags: Vec<String>,
    pub trigger_keywords: Vec<String>,
    pub prerequisites: SkillPrerequisites,
    pub tools_required: Vec<String>,
    pub dependencies: Vec<String>,
}

impl Default for SkillMetadata {
    fn default() -> Self {
        Self {
            name: String::new(),
            description: String::new(),
            version: "1.0.0".to_string(),
            author: String::new(),
            tags: Vec::new(),
            trigger_keywords: Vec::new(),
            prerequisites: SkillPrerequisites::default(),
            tools_required: Vec::new(),
            dependencies: Vec::new(),
        }
    }
}

impl SkillMetadata {
    pub fn new(name: &str, description: &str) -> Self {
        Self {
            name: name.to_string(),
            description: description.to_string(),
            ..Default::default()
        }
    }

    pub fn with_keywords(mut self, keywords: &[&str]) -> Self {
        self.trigger_keywords = keywords.iter().map(|s| s.to_string()).collect();
        self
    }

    pub fn with_tags(mut self, tags: &[&str]) -> Self {
        self.tags = tags.iter().map(|s| s.to_string()).collect();
        self
    }
}

/// 技能 — 对照规格 §Skill @dataclass
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub metadata: SkillMetadata,
    pub content: String,
    pub path: String,
    pub directory: String,
}

impl Skill {
    pub fn new(name: &str, description: &str) -> Self {
        Self {
            metadata: SkillMetadata::new(name, description),
            content: String::new(),
            path: String::new(),
            directory: String::new(),
        }
    }

    pub fn with_keywords(mut self, keywords: &[&str]) -> Self {
        self.metadata = self.metadata.with_keywords(keywords);
        self
    }

    pub fn with_tags(mut self, tags: &[&str]) -> Self {
        self.metadata = self.metadata.with_tags(tags);
        self
    }

    pub fn with_content(mut self, content: &str) -> Self {
        self.content = content.to_string();
        self
    }
}

/// 前置条件检查结果 — 对照规格 §check_prerequisites 返回
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrereqCheckResult {
    pub satisfied: bool,
    pub issues: Vec<String>,
}

// ──────────────────────── SKILL.md 解析 ────────────────────────

/// 解析 SKILL.md 格式文本（YAML frontmatter + 正文）
///
/// 格式：`---\n<YAML frontmatter>\n---\n<content>`
///
/// 简单行解析（不引入 yaml crate）：按 `key: value` 切，`[a, b, c]` 列表解析。
/// 参考前端 `src/utils/localSkills.ts::parseSkillMarkdown`。
///
/// 支持的 frontmatter key：
/// - `name` / `description` / `version` / `author`：字符串
/// - `tags` / `trigger_keywords` / `tools_required` / `dependencies`：列表
/// - `prereq_env` / `prereq_commands`：列表，映射到 `prerequisites`
///
/// 别名兼容（前端 SKILL.md 格式）：
/// - `triggers` → `trigger_keywords`
/// - `allowed_tools` → `tools_required`
/// - `task_types` → `tags`
///
/// 返回 `Some(Skill)` 或 `None`（格式不符 / 缺 name）。
pub fn parse_skill_md(text: &str) -> Option<Skill> {
    let source = text.replace("\r\n", "\n");
    let mut lines = source.split('\n');

    let first = lines.next()?;
    if first.trim() != "---" {
        return None;
    }

    // 收集 frontmatter 直到下一个 `---` 行
    let mut frontmatter: Vec<&str> = Vec::new();
    let mut found_close = false;
    for line in lines.by_ref() {
        if line.trim() == "---" {
            found_close = true;
            break;
        }
        frontmatter.push(line);
    }
    if !found_close {
        return None;
    }

    // 剩余行作为 content（用 \n 连接）
    let content: String = lines.collect::<Vec<&str>>().join("\n");

    // 解析 frontmatter 为 key→value
    let mut meta: HashMap<String, String> = HashMap::new();
    for line in frontmatter {
        if let Some(sep) = line.find(':') {
            if sep == 0 {
                continue;
            }
            let key = line[..sep].trim().to_string();
            let value = line[sep + 1..].trim().to_string();
            if !key.is_empty() {
                meta.insert(key, value);
            }
        }
    }

    let name = meta.get("name")?.clone();
    if name.is_empty() {
        return None;
    }

    let description = meta.get("description").cloned().unwrap_or_default();
    let version = meta
        .get("version")
        .cloned()
        .unwrap_or_else(|| "1.0.0".to_string());
    let author = meta.get("author").cloned().unwrap_or_default();

    let tags = parse_list(meta.get("tags").or_else(|| meta.get("task_types")));
    let trigger_keywords =
        parse_list(meta.get("trigger_keywords").or_else(|| meta.get("triggers")));
    let tools_required =
        parse_list(meta.get("tools_required").or_else(|| meta.get("allowed_tools")));
    let dependencies = parse_list(meta.get("dependencies"));

    let env_vars = parse_list(meta.get("prereq_env"));
    let commands = parse_list(meta.get("prereq_commands"));

    let metadata = SkillMetadata {
        name,
        description,
        version,
        author,
        tags,
        trigger_keywords,
        prerequisites: SkillPrerequisites { env_vars, commands },
        tools_required,
        dependencies,
    };

    Some(Skill {
        metadata,
        content,
        path: String::new(),
        directory: String::new(),
    })
}

/// 解析 `[a, b, c]` 或 `a, b, c` 格式的列表 — 内部辅助函数
fn parse_list(value: Option<&String>) -> Vec<String> {
    let Some(v) = value else {
        return Vec::new();
    };
    let trimmed = v.trim();
    let inner = trimmed
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(trimmed);
    inner
        .split(',')
        .map(|s| s.trim().trim_matches(|c| c == '\'' || c == '"').to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

// ──────────────────────── SkillManager ────────────────────────

/// 技能管理器 — 对照规格 §SkillManager
///
/// 核心接口：register / get / list_all / match / semantic_search / check_prerequisites
pub struct SkillManager {
    skills: HashMap<String, Skill>,
}

impl Default for SkillManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SkillManager {
    pub fn new() -> Self {
        Self {
            skills: HashMap::new(),
        }
    }

    /// 注册技能
    pub fn register(&mut self, skill: Skill) {
        self.skills.insert(skill.metadata.name.clone(), skill);
    }

    /// 获取技能
    pub fn get(&self, name: &str) -> Option<&Skill> {
        self.skills.get(name)
    }

    /// 列出所有技能
    pub fn list_all(&self) -> Vec<&Skill> {
        self.skills.values().collect()
    }

    /// 数量
    pub fn len(&self) -> usize {
        self.skills.len()
    }

    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }

    /// 从目录加载 SKILL.md 文件
    ///
    /// 扫描 `dir` 下每个子目录的 `SKILL.md`，解析并注册。
    /// 返回成功加载数量；读目录失败返回 `Err(message)`。
    pub fn load_dir(&mut self, dir: &str) -> Result<usize, String> {
        let entries =
            std::fs::read_dir(dir).map_err(|e| format!("读取目录失败 {}: {}", dir, e))?;
        let mut count = 0usize;
        for entry in entries {
            let entry = entry.map_err(|e| format!("读取条目失败: {}", e))?;
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let skill_md_path = path.join("SKILL.md");
            if !skill_md_path.is_file() {
                continue;
            }
            let content = match std::fs::read_to_string(&skill_md_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Some(mut skill) = parse_skill_md(&content) {
                skill.path = skill_md_path.to_string_lossy().to_string();
                skill.directory = path.to_string_lossy().to_string();
                self.register(skill);
                count += 1;
            }
        }
        Ok(count)
    }

    /// 关键词匹配 — 对照规格 §match
    ///
    /// 评分规则：trigger_keywords 命中 +1 分，tags 命中 +0.5 分；按分数倒序返回前 limit 个。
    pub fn match_skills(&self, query: &str, limit: usize) -> Vec<&Skill> {
        let query_lower = query.to_lowercase();
        let mut scored: Vec<(&Skill, f64)> = Vec::new();

        for skill in self.skills.values() {
            let mut score = 0.0_f64;
            for kw in &skill.metadata.trigger_keywords {
                if query_lower.contains(&kw.to_lowercase()) {
                    score += 1.0;
                }
            }
            for tag in &skill.metadata.tags {
                if query_lower.contains(&tag.to_lowercase()) {
                    score += 0.5;
                }
            }
            if score > 0.0 {
                scored.push((skill, score));
            }
        }

        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.into_iter().take(limit).map(|(s, _)| s).collect()
    }

    /// 语义搜索（TF-IDF 余弦相似度）— 对照规格 §semantic_search
    ///
    /// 返回 (skill_name, score) 列表，按相似度倒序，取前 limit 个。
    pub fn semantic_search(&self, query: &str, limit: usize) -> Vec<(String, f64)> {
        let n = self.skills.len() as f64;
        if n == 0.0 {
            return Vec::new();
        }

        // 收集所有 skills 的关键词文档
        let docs: Vec<(String, Vec<String>)> = self
            .skills
            .values()
            .map(|s| {
                let mut doc = s.metadata.trigger_keywords.clone();
                doc.extend(s.metadata.tags.iter().cloned());
                (s.metadata.name.clone(), doc)
            })
            .collect();

        // DF: 每个词在多少文档中出现
        let mut df: HashMap<String, usize> = HashMap::new();
        for (_, doc) in &docs {
            for term in doc.iter().collect::<std::collections::HashSet<_>>() {
                *df.entry(term.clone()).or_insert(0) += 1;
            }
        }

        // query TF
        let query_lower = query.to_lowercase();
        let mut scored: Vec<(String, f64)> = Vec::new();
        for (name, doc) in &docs {
            let sim = tfidf_cosine_inner(&query_lower, doc, &df, n);
            if sim > 0.0 {
                scored.push((name.clone(), sim));
            }
        }
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        scored.into_iter().take(limit).collect()
    }

    /// 检查前置条件 — 对照规格 §check_prerequisites
    ///
    /// 简化：传入 env_vars（已设置）、available_commands（可执行）、available_deps（已安装）。
    pub fn check_prerequisites(
        &self,
        skill: &Skill,
        env_vars: &HashMap<String, String>,
        available_commands: &[String],
        available_deps: &[String],
    ) -> PrereqCheckResult {
        let mut issues: Vec<String> = Vec::new();
        let prereq = &skill.metadata.prerequisites;

        for var in &prereq.env_vars {
            if !env_vars.contains_key(var) {
                issues.push(format!("缺少环境变量: {}", var));
            }
        }
        for cmd in &prereq.commands {
            if !available_commands.iter().any(|c| c == cmd) {
                issues.push(format!("命令不可用: {}", cmd));
            }
        }
        for dep in &skill.metadata.dependencies {
            if !available_deps.iter().any(|d| d == dep) {
                issues.push(format!("依赖缺失: {}", dep));
            }
        }

        PrereqCheckResult {
            satisfied: issues.is_empty(),
            issues,
        }
    }
}

// ──────────────────────── 数学公式 ────────────────────────

/// TF-IDF 余弦相似度 — 对照规格 §TF-IDF + 余弦相似度
///
/// `Score(skill, query) = cos(TF-IDF(query), TF-IDF(skill.keywords))`
///
/// 参数：
/// - `query`: 查询字符串（小写）
/// - `doc_keywords`: 技能关键词列表
/// - `all_docs`: 所有技能的关键词列表（用于 DF 计算）
/// - `n`: 技能总数
pub fn tfidf_cosine(
    query: &str,
    doc_keywords: &[String],
    all_docs: &[Vec<String>],
    n: usize,
) -> f64 {
    if n == 0 || doc_keywords.is_empty() {
        return 0.0;
    }
    let n_f = n as f64;

    // DF
    let mut df: HashMap<String, usize> = HashMap::new();
    for doc in all_docs {
        for term in doc.iter().collect::<std::collections::HashSet<_>>() {
            *df.entry(term.clone()).or_insert(0) += 1;
        }
    }

    tfidf_cosine_inner(&query.to_lowercase(), doc_keywords, &df, n_f)
}

/// 内部 TF-IDF 余弦实现（已 lowercase query）
fn tfidf_cosine_inner(
    query_lower: &str,
    doc_keywords: &[String],
    df: &HashMap<String, usize>,
    n: f64,
) -> f64 {
    // query 词频（按空格切分 + 关键词子串匹配）
    let query_terms: Vec<&str> = query_lower.split_whitespace().collect();
    if query_terms.is_empty() || doc_keywords.is_empty() {
        return 0.0;
    }

    // 对每个 doc keyword，计算 tfidf 权重（doc 侧）
    // 简化：doc 中每个 keyword 出现 1 次（去重后）
    let unique_doc: std::collections::HashSet<&String> = doc_keywords.iter().collect();

    // query 侧：对每个 query 词，若 doc 含该词（或 doc keyword 是 query 子串）则计入
    let mut q_vec: Vec<f64> = Vec::new();
    let mut d_vec: Vec<f64> = Vec::new();

    for kw in &unique_doc {
        let kw_lower = kw.to_lowercase();
        // query TF：kw 在 query 中出现次数（子串匹配）
        let q_tf = query_terms
            .iter()
            .filter(|qt| kw_lower.contains(*qt) || qt.contains(kw_lower.as_str()))
            .count() as f64;
        // doc TF：1.0（去重后单次出现）
        let d_tf = 1.0;
        // IDF = log(N / DF)
        let df_val = df.get(&kw_lower).copied().unwrap_or(1) as f64;
        let idf = (n / df_val).ln();
        if idf <= 0.0 {
            continue;
        }
        q_vec.push(q_tf * idf);
        d_vec.push(d_tf * idf);
    }

    if q_vec.is_empty() || d_vec.is_empty() {
        return 0.0;
    }

    // 余弦相似度 = (q·d) / (|q|·|d|)
    let dot: f64 = q_vec.iter().zip(d_vec.iter()).map(|(a, b)| a * b).sum();
    let q_norm: f64 = q_vec.iter().map(|x| x * x).sum::<f64>().sqrt();
    let d_norm: f64 = d_vec.iter().map(|x| x * x).sum::<f64>().sqrt();
    if q_norm == 0.0 || d_norm == 0.0 {
        return 0.0;
    }
    dot / (q_norm * d_norm)
}

/// 前置条件可用概率 P(可用) = ∏ P(req_i)
///
/// 对照规格 §前置条件检查：每个 req_i 的满足概率连乘
pub fn prerequisite_probability(probabilities: &[f64]) -> f64 {
    probabilities.iter().product()
}

// ──────────────────────── 测试 ────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skill_metadata_default() {
        let m = SkillMetadata::default();
        assert_eq!(m.version, "1.0.0");
        assert!(m.tags.is_empty());
        assert!(m.trigger_keywords.is_empty());
    }

    #[test]
    fn skill_metadata_builder() {
        let m = SkillMetadata::new("web-scraper", "网页抓取")
            .with_keywords(&["爬取", "抓取"])
            .with_tags(&["web", "scraping"]);
        assert_eq!(m.name, "web-scraper");
        assert_eq!(m.trigger_keywords, vec!["爬取", "抓取"]);
        assert_eq!(m.tags, vec!["web", "scraping"]);
    }

    #[test]
    fn skill_builder_chaining() {
        let s = Skill::new("stock", "股票分析")
            .with_keywords(&["股票", "K线"])
            .with_tags(&["finance"])
            .with_content("# Stock Analyzer\n步骤...");
        assert_eq!(s.metadata.name, "stock");
        assert_eq!(s.metadata.trigger_keywords.len(), 2);
        assert!(s.content.contains("Stock Analyzer"));
    }

    #[test]
    fn skill_manager_register_and_get() {
        let mut mgr = SkillManager::new();
        mgr.register(Skill::new("a", "desc a"));
        assert_eq!(mgr.len(), 1);
        assert!(mgr.get("a").is_some());
        assert!(mgr.get("b").is_none());
    }

    #[test]
    fn skill_manager_list_all() {
        let mut mgr = SkillManager::new();
        mgr.register(Skill::new("a", "desc a"));
        mgr.register(Skill::new("b", "desc b"));
        assert_eq!(mgr.list_all().len(), 2);
    }

    #[test]
    fn skill_manager_match_by_keyword() {
        let mut mgr = SkillManager::new();
        mgr.register(
            Skill::new("web-scraper", "网页抓取").with_keywords(&["爬取", "抓取", "scrape"]),
        );
        mgr.register(
            Skill::new("code-helper", "代码助手").with_keywords(&["代码", "编程"]),
        );
        // 查询命中第一个 skill
        let matched = mgr.match_skills("帮我爬取网站数据", 5);
        assert_eq!(matched.len(), 1);
        assert_eq!(matched[0].metadata.name, "web-scraper");
    }

    #[test]
    fn skill_manager_match_score_ordering() {
        let mut mgr = SkillManager::new();
        // 双关键词命中 → 高分
        mgr.register(
            Skill::new("a", "a").with_keywords(&["股票", "K线"]).with_tags(&["finance"]),
        );
        // 单关键词命中 → 低分
        mgr.register(
            Skill::new("b", "b").with_keywords(&["股票"]),
        );
        let matched = mgr.match_skills("分析股票K线", 5);
        assert_eq!(matched.len(), 2);
        assert_eq!(matched[0].metadata.name, "a"); // 高分在前
    }

    #[test]
    fn skill_manager_semantic_search_returns_relevant() {
        let mut mgr = SkillManager::new();
        mgr.register(
            Skill::new("web-scraper", "网页抓取")
                .with_keywords(&["爬取", "抓取", "scrape"])
                .with_tags(&["web"]),
        );
        mgr.register(
            Skill::new("stock", "股票分析")
                .with_keywords(&["股票", "K线", "RSI"])
                .with_tags(&["finance"]),
        );
        let results = mgr.semantic_search("分析 股票 K线", 5);
        // stock 应该排名靠前（更多命中）
        assert!(!results.is_empty());
        assert_eq!(results[0].0, "stock");
    }

    #[test]
    fn skill_manager_semantic_search_empty_query() {
        let mut mgr = SkillManager::new();
        mgr.register(Skill::new("a", "a").with_keywords(&["x"]));
        let results = mgr.semantic_search("", 5);
        assert!(results.is_empty());
    }

    #[test]
    fn skill_manager_check_prerequisites_satisfied() {
        let mut mgr = SkillManager::new();
        let mut skill = Skill::new("scraper", "抓取");
        skill.metadata.prerequisites = SkillPrerequisites {
            env_vars: vec!["API_KEY".to_string()],
            commands: vec!["curl".to_string()],
        };
        skill.metadata.dependencies = vec!["requests".to_string()];
        mgr.register(skill);

        let env = HashMap::from([("API_KEY".to_string(), "xxx".to_string())]);
        let cmds = vec!["curl".to_string(), "git".to_string()];
        let deps = vec!["requests".to_string()];

        let result = mgr.check_prerequisites(mgr.get("scraper").unwrap(), &env, &cmds, &deps);
        assert!(result.satisfied);
        assert!(result.issues.is_empty());
    }

    #[test]
    fn skill_manager_check_prerequisites_missing() {
        let mut mgr = SkillManager::new();
        let mut skill = Skill::new("scraper", "抓取");
        skill.metadata.prerequisites = SkillPrerequisites {
            env_vars: vec!["API_KEY".to_string(), "PROXY".to_string()],
            commands: vec!["curl".to_string()],
        };
        skill.metadata.dependencies = vec!["requests".to_string(), "bs4".to_string()];
        mgr.register(skill);

        // 缺 PROXY 和 bs4
        let env = HashMap::from([("API_KEY".to_string(), "xxx".to_string())]);
        let cmds = vec!["curl".to_string()];
        let deps = vec!["requests".to_string()];

        let result = mgr.check_prerequisites(mgr.get("scraper").unwrap(), &env, &cmds, &deps);
        assert!(!result.satisfied);
        assert_eq!(result.issues.len(), 2);
        assert!(result.issues.iter().any(|i| i.contains("PROXY")));
        assert!(result.issues.iter().any(|i| i.contains("bs4")));
    }

    #[test]
    fn tfidf_cosine_high_for_matching_docs() {
        let query = "分析 股票 K线";
        let doc_match = vec_string(&["股票", "K线", "RSI", "MACD"]);
        let doc_other = vec_string(&["编程", "调试", "测试"]);
        let all = vec![doc_match.clone(), doc_other.clone()];
        let sim_match = tfidf_cosine(query, &doc_match, &all, 2);
        let sim_other = tfidf_cosine(query, &doc_other, &all, 2);
        assert!(sim_match > sim_other);
        assert!(sim_match > 0.0);
        assert_eq!(sim_other, 0.0); // 无公共词
    }

    #[test]
    fn prerequisite_probability_product() {
        // 全 1.0 → 1.0
        assert!((prerequisite_probability(&[1.0, 1.0, 1.0]) - 1.0).abs() < 1e-9);
        // 对照规格示例：0.99 × 0.95 × 0.80 = 0.7524
        let p = prerequisite_probability(&[0.99, 0.95, 0.80]);
        assert!((p - 0.7524).abs() < 1e-3);
        // 任一为 0 → 0
        assert_eq!(prerequisite_probability(&[0.99, 0.0, 0.80]), 0.0);
        // 空 → 1.0（空积）
        assert_eq!(prerequisite_probability(&[]), 1.0);
    }

    // ─── parse_skill_md / load_dir ───

    #[test]
    fn test_parse_skill_md_basic() {
        let md = "---\nname: test-skill\ndescription: 测试技能\nversion: 2.0.0\nauthor: tester\ntags: [web, scraping]\ntrigger_keywords: [爬取, 抓取]\ntools_required: [curl, wget]\ndependencies: [requests]\nprereq_env: [API_KEY]\nprereq_commands: [curl]\n---\n\n# Test Skill\n\n这是正文。\n";
        let skill = parse_skill_md(md).expect("应解析成功");
        assert_eq!(skill.metadata.name, "test-skill");
        assert_eq!(skill.metadata.description, "测试技能");
        assert_eq!(skill.metadata.version, "2.0.0");
        assert_eq!(skill.metadata.author, "tester");
        assert_eq!(skill.metadata.tags, vec!["web", "scraping"]);
        assert_eq!(skill.metadata.trigger_keywords, vec!["爬取", "抓取"]);
        assert_eq!(skill.metadata.tools_required, vec!["curl", "wget"]);
        assert_eq!(skill.metadata.dependencies, vec!["requests"]);
        assert_eq!(skill.metadata.prerequisites.env_vars, vec!["API_KEY"]);
        assert_eq!(skill.metadata.prerequisites.commands, vec!["curl"]);
        assert!(skill.content.contains("Test Skill"));
        assert!(skill.content.contains("这是正文。"));
    }

    #[test]
    fn test_parse_skill_md_aliases() {
        // 兼容前端 SKILL.md 格式（triggers/allowed_tools/task_types 别名）
        let md = "---\nname: novel-quality\ndescription: 小说质量\nversion: 1.0.0\ntask_types: [chapter_writing]\ntriggers: [规范, 合规]\nallowed_tools: [write_chapter]\n---\n正文\n";
        let skill = parse_skill_md(md).expect("应解析成功");
        assert_eq!(skill.metadata.name, "novel-quality");
        assert_eq!(skill.metadata.tags, vec!["chapter_writing"]);
        assert_eq!(skill.metadata.trigger_keywords, vec!["规范", "合规"]);
        assert_eq!(skill.metadata.tools_required, vec!["write_chapter"]);
    }

    #[test]
    fn test_parse_skill_md_invalid() {
        // 无 frontmatter
        assert!(parse_skill_md("just plain text").is_none());
        // 缺 name
        assert!(parse_skill_md("---\ndescription: no name\n---\nbody\n").is_none());
        // 未闭合 frontmatter
        assert!(parse_skill_md("---\nname: foo\nbody without close").is_none());
    }

    #[test]
    fn test_load_dir() {
        use std::env;
        use std::fs;
        use std::sync::atomic::{AtomicU64, Ordering};

        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);

        let mut tmp = env::temp_dir();
        tmp.push(format!("inkweave_skill_test_{}_{}", std::process::id(), id));
        // 清理可能残留的旧目录
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).expect("创建临时目录失败");

        // 子目录 1：有效 SKILL.md
        let sub1 = tmp.join("skill-a");
        fs::create_dir_all(&sub1).unwrap();
        fs::write(
            sub1.join("SKILL.md"),
            "---\nname: skill-a\ndescription: 技能 A\ntriggers: [foo]\n---\nA 内容\n",
        )
        .unwrap();

        // 子目录 2：有效 SKILL.md
        let sub2 = tmp.join("skill-b");
        fs::create_dir_all(&sub2).unwrap();
        fs::write(
            sub2.join("SKILL.md"),
            "---\nname: skill-b\ndescription: 技能 B\ntriggers: [bar]\n---\nB 内容\n",
        )
        .unwrap();

        // 子目录 3：无 SKILL.md（应被跳过）
        let sub3 = tmp.join("empty-dir");
        fs::create_dir_all(&sub3).unwrap();

        // 子目录 4：无效 SKILL.md（缺 name，应被跳过）
        let sub4 = tmp.join("bad-skill");
        fs::create_dir_all(&sub4).unwrap();
        fs::write(
            sub4.join("SKILL.md"),
            "---\ndescription: no name\n---\nbody\n",
        )
        .unwrap();

        // 普通文件（应被跳过）
        fs::write(tmp.join("not-a-dir.txt"), "hello").unwrap();

        let mut mgr = SkillManager::new();
        let count = mgr
            .load_dir(tmp.to_str().unwrap())
            .expect("load_dir 应成功");
        assert_eq!(count, 2);
        assert_eq!(mgr.len(), 2);
        assert!(mgr.get("skill-a").is_some());
        assert!(mgr.get("skill-b").is_some());

        // 验证加载的技能字段
        let skill_a = mgr.get("skill-a").expect("skill-a 应存在");
        assert_eq!(skill_a.metadata.trigger_keywords, vec!["foo"]);
        assert!(skill_a.content.contains("A 内容"));
        assert!(!skill_a.path.is_empty(), "path 应被设置");
        assert!(!skill_a.directory.is_empty(), "directory 应被设置");

        // 清理
        let _ = fs::remove_dir_all(&tmp);
    }

    fn vec_string(slice: &[&str]) -> Vec<String> {
        slice.iter().map(|s| s.to_string()).collect()
    }
}
