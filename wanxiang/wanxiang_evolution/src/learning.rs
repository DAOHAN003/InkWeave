//! LearningLayer — 五层文本学习
//! 从 Python unified_evolution.py LearningLayer 完整翻译
//!
//! 第一层: 词法 — 分词 + 停用词过滤 + 频率统计
//! 第二层: 语法 — 识别条件/因果/依赖模式
//! 第三层: 语义 — 主题聚类
//! 第四层: 推理 — 模式链 + 跨主题桥接
//! 第五层: 元认知 — 评估各层效果

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wanxiang_types::config::evolution::*;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LearnResult {
    pub lexicon_top: HashMap<String, u32>,
    pub patterns: Vec<HashMap<String, serde_json::Value>>,
    pub clusters: HashMap<String, Vec<String>>,
    pub inferences: Vec<HashMap<String, serde_json::Value>>,
    pub meta_scores: HashMap<String, f64>,
    pub cycle: u64,
}

pub struct LearningLayer {
    lexicon: HashMap<String, u32>,
    patterns: Vec<HashMap<String, serde_json::Value>>,
    topics: HashMap<String, Vec<String>>,
    inferences: Vec<HashMap<String, serde_json::Value>>,
    meta_scores: HashMap<String, f64>,
    learning_cycles: u64,
}

impl LearningLayer {
    pub fn new() -> Self {
        let mut meta_scores = HashMap::new();
        for k in &["lexical", "syntactic", "semantic", "inference", "meta"] {
            meta_scores.insert(k.to_string(), META_SCORE_DEFAULT);
        }
        Self {
            lexicon: HashMap::new(),
            patterns: Vec::new(),
            topics: HashMap::new(),
            inferences: Vec::new(),
            meta_scores,
            learning_cycles: 0,
        }
    }

    // 停用词集合
    fn is_stopword(word: &str) -> bool {
        const STOP: &[&str] = &[
            "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一", "一个",
            "上", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好",
            "自己", "这", "他", "她",
            "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
            "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
            "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with",
            "at", "by", "from", "as", "into", "through", "during", "before", "after",
            "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
            "this", "that", "these", "those", "it", "its", "we", "our",
        ];
        STOP.contains(&word)
    }

    // 第一层: 词法
    fn lexical_extract(&mut self, text: &str) -> HashMap<String, u32> {
        let mut tokens: Vec<String> = Vec::new();
        let mut word = String::new();
        for ch in text.chars() {
            if ch.is_alphanumeric() || ('\u{4e00}'..='\u{9fff}').contains(&ch) {
                word.push(ch);
            } else if !word.is_empty() {
                tokens.push(word.to_lowercase());
                word.clear();
            }
        }
        if !word.is_empty() {
            tokens.push(word.to_lowercase());
        }

        let mut freq: HashMap<String, u32> = HashMap::new();
        for tok in &tokens {
            if tok.len() >= 2 && !Self::is_stopword(tok) {
                *freq.entry(tok.clone()).or_insert(0) += 1;
            }
        }
        for (w, &c) in &freq {
            *self.lexicon.entry(w.clone()).or_insert(0) += c;
        }
        freq
    }

    // 第二层: 语法 — 识别条件/因果/依赖模式
    fn syntactic_patterns(&mut self, text: &str, lexicon: &HashMap<String, u32>) -> Vec<HashMap<String, serde_json::Value>> {
        let mut patterns: Vec<HashMap<String, serde_json::Value>> = Vec::new();
        let markers = [
            ("如果", "那么"), ("如果", "就"), ("当", "时"),
            ("因为", "所以"), ("由于", "因此"), ("需要", "才能"), ("只有", "才"),
        ];

        let mut top_words: Vec<(String, u32)> = lexicon.iter()
            .map(|(k, v)| (k.clone(), *v))
            .collect();
        top_words.sort_by(|a, b| b.1.cmp(&a.1));
        top_words.truncate(10);

        for sent in text.replace('\n', "|").split('|') {
            let sent = sent.trim();
            if sent.is_empty() { continue; }

            for (sm, em) in &markers {
                if sent.contains(sm) && sent.contains(em) {
                    let si = sent.find(sm).unwrap() + sm.chars().count();
                    let ei = sent.find(em).unwrap();
                    if si < ei {
                        let cond: String = sent[si..ei].trim().chars().take(60).collect();
                        let res: String = sent[ei + em.len()..].trim().chars().take(60).collect();
                        if !cond.is_empty() && !res.is_empty() {
                            let cond_len = cond.chars().count() as f64;
                            let mut p = HashMap::new();
                            p.insert("type".to_string(), serde_json::Value::String("conditional".to_string()));
                            p.insert("condition".to_string(), serde_json::Value::String(cond));
                            p.insert("result".to_string(), serde_json::Value::String(res));
                            let conf = CONF_BASE + CONF_STEP * cond_len.min(CONF_NORM) / CONF_NORM;
                            p.insert("confidence".to_string(), serde_json::Value::from(conf));
                            patterns.push(p);
                        }
                    }
                }
            }

            // 共现模式
            for i in 0..top_words.len() {
                for j in (i+1)..top_words.len() {
                    let w1 = &top_words[i].0;
                    let w2 = &top_words[j].0;
                    if w1 != w2 && sent.contains(w1.as_str()) && sent.contains(w2.as_str()) {
                        let mut p = HashMap::new();
                        p.insert("type".to_string(), serde_json::Value::String("co_occurrence".to_string()));
                        p.insert("words".to_string(), serde_json::Value::Array(vec![
                            serde_json::Value::String(w1.clone()),
                            serde_json::Value::String(w2.clone()),
                        ]));
                        p.insert("confidence".to_string(), serde_json::Value::from(LEARN_CONF_DEFAULT));
                        patterns.push(p);
                    }
                }
            }
        }
        self.patterns.extend(patterns.clone());
        patterns
    }

    // 第三层: 语义 — 主题聚类
    fn semantic_cluster(&mut self, lexicon: &HashMap<String, u32>) -> HashMap<String, Vec<String>> {
        let seeds: [(&str, &[&str]); 5] = [
            ("技术", &["代码", "编程", "系统", "算法", "架构", "框架", "模块", "函数", "接口", "数据", "性能", "优化", "code", "system", "api", "bug", "debug", "测试", "部署"]),
            ("设计", &["设计", "方案", "结构", "模式", "原型", "用户体验", "界面", "交互", "design", "ui", "ux"]),
            ("业务", &["需求", "用户", "产品", "功能", "市场", "运营", "指标", "增长", "转化", "business", "product"]),
            ("学习", &["学习", "训练", "模型", "知识", "经验", "总结", "分析", "研究", "learn", "train", "model"]),
            ("质量", &["质量", "测试", "稳定", "可靠", "安全", "规范", "review", "test", "quality", "标准"]),
        ];

        let mut clusters: HashMap<String, Vec<String>> = HashMap::new();
        for (topic, seed_list) in &seeds {
            let matched: Vec<String> = lexicon.keys()
                .filter(|w| seed_list.iter().any(|s| w.contains(s) || s.contains(w.as_str())))
                .cloned()
                .collect();
            if !matched.is_empty() {
                let mut sorted = matched;
                sorted.sort_by(|a, b| lexicon.get(b).unwrap_or(&0).cmp(lexicon.get(a).unwrap_or(&0)));
                sorted.truncate(15);
                clusters.insert(topic.to_string(), sorted);
            }
        }
        self.topics.extend(clusters.clone());
        clusters
    }

    // 第四层: 推理 — 模式链 + 跨主题桥接
    fn inference_engine(
        &mut self,
        patterns: &[HashMap<String, serde_json::Value>],
        clusters: &HashMap<String, Vec<String>>,
    ) -> Vec<HashMap<String, serde_json::Value>> {
        let mut inferences: Vec<HashMap<String, serde_json::Value>> = Vec::new();

        // 条件链推理
        let conds: Vec<&HashMap<String, serde_json::Value>> = patterns.iter()
            .filter(|p| p.get("type").and_then(|v| v.as_str()) == Some("conditional"))
            .collect();

        for i in 0..conds.len() {
            for j in (i+1)..conds.len() {
                let p1_result = conds[i].get("result").and_then(|v| v.as_str()).unwrap_or("");
                let p2_cond = conds[j].get("condition").and_then(|v| v.as_str()).unwrap_or("");
                let overlap: Vec<char> = p1_result.chars()
                    .filter(|c| p2_cond.contains(*c))
                    .collect();
                if overlap.len() >= 3 {
                    let mut inf = HashMap::new();
                    inf.insert("type".to_string(), serde_json::Value::String("chain".to_string()));
                    inf.insert("from".to_string(), serde_json::Value::String(
                        conds[i].get("condition").and_then(|v| v.as_str()).unwrap_or("").chars().take(40).collect()
                    ));
                    inf.insert("through".to_string(), serde_json::Value::String(p1_result.chars().take(40).collect()));
                    inf.insert("to".to_string(), serde_json::Value::String(
                        conds[j].get("result").and_then(|v| v.as_str()).unwrap_or("").chars().take(40).collect()
                    ));
                    inferences.push(inf);
                }
            }
        }

        // 跨主题桥接
        let topic_list: Vec<(&String, &Vec<String>)> = clusters.iter().collect();
        for i in 0..topic_list.len() {
            for j in (i+1)..topic_list.len() {
                let shared: Vec<&String> = topic_list[i].1.iter()
                    .filter(|w| topic_list[j].1.contains(w))
                    .collect();
                if !shared.is_empty() {
                    let mut inf = HashMap::new();
                    inf.insert("type".to_string(), serde_json::Value::String("bridge".to_string()));
                    inf.insert("topics".to_string(), serde_json::Value::Array(vec![
                        serde_json::Value::String(topic_list[i].0.clone()),
                        serde_json::Value::String(topic_list[j].0.clone()),
                    ]));
                    inf.insert("shared_keywords".to_string(), serde_json::Value::Array(
                        shared.iter().take(5).map(|s| serde_json::Value::String(s.to_string())).collect()
                    ));
                    inferences.push(inf);
                }
            }
        }

        self.inferences.extend(inferences.clone());
        inferences
    }

    // 第五层: 元认知 — 评估各层效果
    fn meta_optimize(&mut self, lex_n: usize, pat_n: usize, clu_n: usize, inf_n: usize) -> HashMap<String, f64> {
        let richness = |count: usize, ideal: usize| -> f64 {
            if count == 0 { return 0.0; }
            ((1.0 + count as f64).ln() / (1.0 + ideal as f64).ln()).min(1.0)
        };
        let scores = [
            ("lexical", richness(lex_n, 50)),
            ("syntactic", richness(pat_n, 10)),
            ("semantic", richness(clu_n, 5)),
            ("inference", richness(inf_n, 5)),
        ];
        let alpha = LEARNING_ALPHA;
        for (layer, ns) in &scores {
            let current = *self.meta_scores.get(*layer).unwrap_or(&META_SCORE_DEFAULT);
            self.meta_scores.insert(layer.to_string(), alpha * ns + (1.0 - alpha) * current);
        }
        let vals: Vec<f64> = ["lexical", "syntactic", "semantic", "inference"]
            .iter()
            .filter_map(|k| self.meta_scores.get(*k))
            .copied()
            .collect();
        if !vals.is_empty() {
            let mean = vals.iter().sum::<f64>() / vals.len() as f64;
            let variance: f64 = vals.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / vals.len() as f64;
            self.meta_scores.insert("meta".to_string(), (1.0 - variance.sqrt()).max(0.0));
        }
        self.meta_scores.clone()
    }

    /// 五层全流水线学习
    pub fn learn_from_text(&mut self, text: &str) -> LearnResult {
        if text.trim().is_empty() {
            return LearnResult { cycle: self.learning_cycles, ..Default::default() };
        }
        self.learning_cycles += 1;
        let lex = self.lexical_extract(text);
        let pat = self.syntactic_patterns(text, &lex);
        let clu = self.semantic_cluster(&lex);
        let inf = self.inference_engine(&pat, &clu);
        let meta = self.meta_optimize(lex.len(), pat.len(), clu.len(), inf.len());

        let mut lex_top: Vec<(String, u32)> = lex.into_iter().collect();
        lex_top.sort_by(|a, b| b.1.cmp(&a.1));
        lex_top.truncate(20);
        let lexicon_top: HashMap<String, u32> = lex_top.into_iter().collect();

        LearnResult {
            lexicon_top,
            patterns: pat.into_iter().take(10).collect(),
            clusters: clu,
            inferences: inf.into_iter().take(5).collect(),
            meta_scores: meta,
            cycle: self.learning_cycles,
        }
    }

    pub fn knowledge_summary(&self) -> HashMap<String, serde_json::Value> {
        let mut summary = HashMap::new();
        summary.insert("total_words".to_string(), serde_json::Value::from(self.lexicon.len()));
        summary.insert("total_patterns".to_string(), serde_json::Value::from(self.patterns.len()));
        summary.insert("total_topics".to_string(), serde_json::Value::from(self.topics.len()));
        summary.insert("total_inferences".to_string(), serde_json::Value::from(self.inferences.len()));
        summary.insert("learning_cycles".to_string(), serde_json::Value::from(self.learning_cycles));
        summary
    }
}

impl Default for LearningLayer {
    fn default() -> Self { Self::new() }
}
