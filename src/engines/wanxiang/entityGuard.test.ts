/**
 * entityGuard 测试（V5.7）。
 * 用例全部来自 2026-09-25 对《万象矿脉录》四章成稿的真实取证场景。
 */
import { describe, it, expect } from 'vitest';
import {
  scanEntityIds,
  resolveEntityIds,
  buildEntityNameMapFromText,
  sanitizeSimulationTokens,
  isPredominantlyCjk,
  scanSimulationArtifacts,
  scanCliches,
  aggregateCliches,
  scanSimileDensity,
  checkThinChapter,
  attributePronouns,
  detectPronounFlip,
  buildEntityNameBlock,
  buildClicheDisciplineBlock,
  runTextGuards,
  formatTextGuardIssues,
} from './entityGuard';

// ─────────────────────────── 1. 实体 ID ───────────────────────────

describe('scanEntityIds', () => {
  it('抓取已知前缀 ID 并统一小写去重', () => {
    const text = 'char_70 和 Char_70 与 fac_12、loc_3';
    expect(scanEntityIds(text).sort()).toEqual(['char_70', 'fac_12', 'loc_3']);
  });
  it('不误伤更长 ID 的前缀（词边界）', () => {
    expect(scanEntityIds('char_700 和 char_70')).toContain('char_700');
    expect(scanEntityIds('char_700 和 char_70')).toContain('char_70');
  });
  it('不匹配下划线粘连的词（npc_char_70 整体不算）', () => {
    expect(scanEntityIds('npc_char_70')).toEqual([]);
  });
  it('中文紧贴时仍能命中（CJK 非词字符）', () => {
    expect(scanEntityIds('把char_70叫来')).toEqual(['char_70']);
  });
});

describe('resolveEntityIds', () => {
  const names = { char_70: '梁雪吟', fac_12: '玄铁矿脉商会' };
  it('有映射的 ID 确定性替换（含大小写变体 Char_70）', () => {
    const r = resolveEntityIds('Char_70 走进大殿，char_70 的目光扫过众人。', names);
    expect(r.text).toBe('梁雪吟 走进大殿，梁雪吟 的目光扫过众人。');
    expect(r.replaced).toEqual([{ id: 'char_70', name: '梁雪吟', count: 2 }]);
    expect(r.unresolved).toEqual([]);
  });
  it('无映射的 ID 原样保留并记录', () => {
    const r = resolveEntityIds('char_99 出现了两次，char_99 又出现。', names);
    expect(r.text).toBe('char_99 出现了两次，char_99 又出现。');
    expect(r.unresolved).toEqual([{ id: 'char_99', count: 2 }]);
  });
  it('映射与未映射混合：替换的替换、保留的保留', () => {
    const r = resolveEntityIds('fac_12 与 char_70、char_99 对峙。', names);
    expect(r.text).toBe('玄铁矿脉商会 与 梁雪吟、char_99 对峙。');
    expect(r.replaced.map((x) => x.id).sort()).toEqual(['char_70', 'fac_12']);
    expect(r.unresolved).toEqual([{ id: 'char_99', count: 1 }]);
  });
});

describe('buildEntityNameMapFromText', () => {
  it('解析「ID·名字」写法', () => {
    const map = buildEntityNameMapFromText('出场：char_70·梁雪吟、fac_12·玄铁商会');
    expect(map['char_70']).toBe('梁雪吟');
    expect(map['fac_12']).toBe('玄铁商会');
  });
  it('解析「ID：名字」与「ID(名字)」写法', () => {
    const map = buildEntityNameMapFromText('char_70：梁雪吟\nfac_12(玄铁商会) 参与事件');
    expect(map['char_70']).toBe('梁雪吟');
    expect(map['fac_12']).toBe('玄铁商会');
  });
  it('解析「名字(ID)」写法', () => {
    const map = buildEntityNameMapFromText('梁雪吟（char_70）率先出手');
    expect(map['char_70']).toBe('梁雪吟');
  });
  it('空文本返回空映射', () => {
    expect(buildEntityNameMapFromText('')).toEqual({});
  });
});

// ─────────────────────── 2. 模拟字段残留 + 源头清洗 ───────────────────────

describe('sanitizeSimulationTokens', () => {
  it('outcome/trigger 替换为中文等义词（保留冒号结构）', () => {
    const out = sanitizeSimulationTokens('冲突 outcome: char_70 胜，trigger: 资源争夺');
    expect(out).toBe('冲突 结果: char_70 胜，诱因: 资源争夺');
  });
  it('词边界保护：outcomes 不被替换成 结果s', () => {
    expect(sanitizeSimulationTokens('the outcomes are')).not.toContain('结果');
  });
  it('空文本安全', () => {
    expect(sanitizeSimulationTokens('')).toBe('');
  });
});

describe('isPredominantlyCjk / scanSimulationArtifacts', () => {
  it('中文为主的文本判定为 CJK', () => {
    expect(isPredominantlyCjk('这是一段足够长的中文文本，'.repeat(10))).toBe(true);
  });
  it('英文文本不判 CJK（残留检查不适用）', () => {
    expect(isPredominantlyCjk('This is a sufficiently long English text. '.repeat(10))).toBe(false);
  });
  it('抓 outcome/trigger 等字段名残留', () => {
    const r = scanSimulationArtifacts('他赢了这一局，outcome 是矿脉归属易手，trigger 已完成。'.repeat(3));
    const tokens = r.tokens.map((t) => t.token);
    expect(tokens).toContain('outcome');
    expect(tokens).toContain('trigger');
  });
  it('抓 snake_case 残留（ID 替换后剩下的）', () => {
    const r = scanSimulationArtifacts('局势出现了明显的波动，所有人都在观望，谁也不知道接下来会发生什么，只能等待 emotional_state 的结果，faction_id 依然未知。'.repeat(3));
    const snakes = r.snakeCase.map((t) => t.token);
    expect(snakes).toContain('emotional_state');
    expect(snakes).toContain('faction_id');
  });
  it('正常中文无英文时不报', () => {
    const r = scanSimulationArtifacts('他推开门，屋里空无一人，只有风穿过窗棂。'.repeat(5));
    expect(r.tokens).toEqual([]);
    expect(r.snakeCase).toEqual([]);
  });
  it('英文单词作为正常内容（如 OK）不触发 token 名单', () => {
    const r = scanSimulationArtifacts('他说 OK，然后转身离开，继续往前走去，没有回头。'.repeat(3));
    expect(r.tokens).toEqual([]);
  });
});

// ─────────────────────────── 3. 口头禅 ───────────────────────────

describe('scanCliches', () => {
  it('证据①：嘴角勾起一抹 ×3 命中', () => {
    const text = '他嘴角勾起一抹弧度。她又看他嘴角勾起一抹冷笑。我嘴角勾起一抹笑意。';
    const hit = scanCliches(text).find((h) => h.label.includes('嘴角勾起'));
    expect(hit?.count).toBeGreaterThanOrEqual(3);
  });
  it('证据②：钝刀 ×3 命中', () => {
    const text = '这话像一把钝刀，钝刀割肉，钝刀磨人。';
    const hit = scanCliches(text).find((h) => h.label === '钝刀比喻');
    expect(hit?.count).toBeGreaterThanOrEqual(3);
  });
  it('证据③：瞳孔 ×5 命中', () => {
    const text = '瞳孔骤缩。瞳孔一缩。瞳孔微缩。瞳孔地震般收缩。瞳孔猛缩。';
    const hit = scanCliches(text).find((h) => h.label.includes('瞳孔'));
    expect(hit?.count).toBeGreaterThanOrEqual(5);
  });
  it('正常叙述不误报', () => {
    const text = '他把刀放下，走到门口，听见外面有脚步声，于是停住了。'.repeat(3);
    expect(scanCliches(text)).toEqual([]);
  });
  it('每类命中附样例', () => {
    const hit = scanCliches('他深吸一口气，又深吸一口气。');
    expect(hit[0].samples[0]).toBe('深吸一口气');
  });
});

describe('aggregateCliches', () => {
  it('跨章聚合：每章 1 次 × 4 章 → 总 4 次', () => {
    const chapters = [1, 2, 3, 4].map((index) => ({
      index,
      content: `第${index}章，他嘴角勾起一抹弧度，然后继续赶路。`,
    }));
    const agg = aggregateCliches(chapters);
    const mouth = agg.find((a) => a.label.includes('嘴角勾起'));
    expect(mouth?.totalCount).toBeGreaterThanOrEqual(4);
    expect(mouth?.chapters).toEqual([1, 2, 3, 4]);
  });
});

// ─────────────────────────── 4. 明喻密度 ───────────────────────────

describe('scanSimileDensity', () => {
  it('证据：28 处 / 8,338 字 ≈ 33.6/万字 → 超 fail 线 24', () => {
    const text = '好'.repeat(8338 - 28 * 2) + '像是'.repeat(13) + '仿佛'.repeat(8) + '宛如'.repeat(3) + '如同'.repeat(4);
    const r = scanSimileDensity(text);
    expect(r.count).toBe(28);
    expect(r.per10k).toBeGreaterThanOrEqual(24);
  });
  it('低密度文本达标', () => {
    const text = '他推门进来，坐下，倒茶，喝了一口，然后开口说话，语气平静。'.repeat(20);
    const r = scanSimileDensity(text);
    expect(r.count).toBe(0);
    expect(r.per10k).toBeLessThan(12);
  });
  it('markers 分项计数正确', () => {
    const r = scanSimileDensity('像是A。仿佛B。像是C。');
    expect(r.markers['像是']).toBe(2);
    expect(r.markers['仿佛']).toBe(1);
  });
});

// ─────────────────────────── 5. 薄章 ───────────────────────────

describe('checkThinChapter', () => {
  it('证据：ch2 1,196 字 / 目标 2,000 → 薄章', () => {
    const text = '字'.repeat(1196);
    const r = checkThinChapter(text, 2000);
    expect(r.thin).toBe(true);
  });
  it('达标章不误报（2,100 字 / 目标 2,000）', () => {
    const text = '字'.repeat(2100);
    expect(checkThinChapter(text, 2000).thin).toBe(false);
  });
  it('无目标时用绝对下限（999 字 → 薄）', () => {
    const text = '字'.repeat(999);
    expect(checkThinChapter(text).thin).toBe(true);
  });
  it('无目标 1,100 字 → 薄（绝对下限 1,500，证据 ch2 1,196）', () => {
    const text = '字'.repeat(1100);
    expect(checkThinChapter(text).thin).toBe(true);
  });
  it('无目标 1,600 字 → 不薄', () => {
    const text = '字'.repeat(1600);
    expect(checkThinChapter(text).thin).toBe(false);
  });
  it('空白字符不计入字数', () => {
    const text = '字'.repeat(500) + ' '.repeat(2000);
    expect(checkThinChapter(text).length).toBe(500);
  });
});

// ─────────────────────── 6. 代词性别翻转 ───────────────────────

describe('attributePronouns', () => {
  it('单名句的 她/他 归属到该角色', () => {
    const r = attributePronouns('梁雪吟抬头，她看见远处的灯火。梁雪吟皱眉，她没有说话。', ['梁雪吟']);
    expect(r.get('梁雪吟')).toEqual({ he: 0, she: 2 });
  });
  it('他们/她们/其他 不计入单数代词', () => {
    const r = attributePronouns('梁雪吟看着他们离开，她没有动。其他人也走了，她们的灯还亮着。', ['梁雪吟']);
    expect(r.get('梁雪吟')).toEqual({ he: 0, she: 1 });
  });
  it('全句只有复数/其他代词时不注册归属', () => {
    const r = attributePronouns('梁雪吟看着他们离开，其他人也走了，她们的灯还亮着。', ['梁雪吟']);
    expect(r.get('梁雪吟')).toBeUndefined();
  });
  it('双名句跳过（歧义不归属）', () => {
    const r = attributePronouns('梁雪吟看着徐梦璃，她笑了。', ['梁雪吟', '徐梦璃']);
    expect(r.size).toBe(0);
  });
  it('长名优先：句中有梁雪吟时短名雪吟不抢归属', () => {
    const r = attributePronouns('梁雪吟回头，她走了。', ['雪吟', '梁雪吟']);
    expect(r.get('梁雪吟')).toEqual({ he: 0, she: 1 });
    expect(r.get('雪吟')).toBeUndefined();
  });
  it('无名句不归属', () => {
    const r = attributePronouns('她走了很远的路。', ['梁雪吟']);
    expect(r.size).toBe(0);
  });
});

describe('detectPronounFlip', () => {
  const names = ['梁雪吟'];
  const mk = (pronoun: string, n: number) =>
    Array.from({ length: n }, () => `梁雪吟停下脚步，${pronoun}望向山谷深处。`).join('');
  it('证据：ch1 她×80 → ch4 他×24 判翻转', () => {
    const chapters = [
      { index: 1, content: mk('她', 40) + '梁雪吟看她，她想了想，她说好。' },
      { index: 2, content: mk('她', 20) },
      { index: 3, content: mk('她', 20) },
      { index: 4, content: mk('他', 24) },
    ];
    const flips = detectPronounFlip(chapters, names);
    expect(flips).toHaveLength(1);
    expect(flips[0].name).toBe('梁雪吟');
    expect(flips[0].baseline).toBe('she');
    expect(flips[0].flippedChapters).toEqual([4]);
  });
  it('样本量不足（<8）不判定', () => {
    const chapters = [
      { index: 1, content: mk('她', 3) },
      { index: 2, content: mk('他', 3) },
    ];
    expect(detectPronounFlip(chapters, names)).toEqual([]);
  });
  it('少数派未过单章阈值不判翻转', () => {
    const chapters = [
      { index: 1, content: mk('她', 30) },
      { index: 2, content: mk('她', 10) + '梁雪吟看他一眼。' },
    ];
    expect(detectPronounFlip(chapters, names)).toEqual([]);
  });
  it('一致使用「他」的角色不误报', () => {
    const chapters = [
      { index: 1, content: mk('他', 20) },
      { index: 2, content: mk('他', 20) },
    ];
    expect(detectPronounFlip(chapters, names)).toEqual([]);
  });
});

// ─────────────────────── 7. 提示词块 ───────────────────────

describe('buildEntityNameBlock / buildClicheDisciplineBlock', () => {
  it('实体名块包含名字、ID 与禁令', () => {
    const block = buildEntityNameBlock({ char_70: '梁雪吟' });
    expect(block).toContain('梁雪吟');
    expect(block).toContain('char_70');
    expect(block).toContain('严禁');
  });
  it('空映射返回空串（不污染 prompt）', () => {
    expect(buildEntityNameBlock({})).toBe('');
  });
  it('纪律块含黑名单样例与明喻限量', () => {
    const block = buildClicheDisciplineBlock();
    expect(block).toContain('禁口头禅');
    expect(block).toContain('明喻限量');
    expect(block).toContain('像是');
  });
});

// ─────────────────────── 8. 顶层 runTextGuards ───────────────────────

describe('runTextGuards', () => {
  const names = { char_70: '梁雪吟' };
  it('端到端①：ID 泄漏章 —— char_70 确定性替换 + outcome 记 fail', () => {
    const raw = 'char_70 走进矿洞，把char_70叫来，这是 outcome 的一部分。'.repeat(2);
    const { text, report } = runTextGuards(raw, { names });
    expect(text).not.toContain('char_70');
    expect(text).toContain('梁雪吟');
    expect(report.resolution.replaced[0]).toMatchObject({ id: 'char_70', name: '梁雪吟' });
    expect(report.violations.some((v) => v.kind === 'artifact' && v.severity === 'fail')).toBe(true);
    expect(report.passed).toBe(false);
  });
  it('端到端②：无映射 ID 残留 → fail', () => {
    const raw = 'char_99 出现在矿洞深处，周围一片死寂，没有任何声音传来，安静得可怕。';
    const { report } = runTextGuards(raw, { names });
    expect(report.violations.some((v) => v.kind === 'entity-id' && v.severity === 'fail')).toBe(true);
    expect(report.passed).toBe(false);
  });
  it('端到端③：口头禅超限 → fail（证据场景复现）', () => {
    const raw = '他嘴角勾起一抹弧度。他嘴角勾起一抹冷笑。她嘴角勾起一抹讥讽。'.repeat(2);
    const { report } = runTextGuards(raw, { names });
    expect(report.violations.some((v) => v.kind === 'cliche' && v.severity === 'fail')).toBe(true);
  });
  it('端到端④：明喻过密 → fail', () => {
    const raw = '像是'.repeat(10) + '仿佛'.repeat(6) + '宛如'.repeat(3) + '如同'.repeat(4) + '好'.repeat(4000);
    const { report } = runTextGuards(raw, { names });
    expect(report.violations.some((v) => v.kind === 'simile' && v.severity === 'fail')).toBe(true);
  });
  it('端到端⑤：薄章 → fail', () => {
    const raw = '字'.repeat(900);
    const { report } = runTextGuards(raw, { names, targetChars: 2000 });
    expect(report.violations.some((v) => v.kind === 'thin' && v.severity === 'fail')).toBe(true);
  });
  it('端到端⑥：干净文本 → passed（无 fail 违规）', () => {
    const raw = '梁雪吟把矿图摊在石台上，指尖沿着标注的红线走了一遍，又停在断层处。'.repeat(48);
    const { report } = runTextGuards(raw, { names });
    expect(report.passed).toBe(true);
  });
  it('formatTextGuardIssues 产出质量门 issue 行', () => {
    const { report } = runTextGuards('char_99 出现了，周围死寂。', { names });
    const lines = formatTextGuardIssues(report);
    expect(lines.some((l) => l.includes('【文风红线·entity-id】'))).toBe(true);
  });
});

describe('attributePronouns 段落级 POV 归属', () => {
  it('无名句归属到段落唯一名字（网文 POV 惯例：段=多句块）', () => {
    const content = '梁雪吟站在观测台前。她调出数据流。她一遍遍重算。\n周无极推门进来，两人对视。';
    const r = attributePronouns(content, ['梁雪吟', '周无极']);
    expect(r.get('梁雪吟')).toEqual({ he: 0, she: 2 });
  });
  it('段内多名字时无名句跳过（歧义）', () => {
    const content = '梁雪吟看着周无极。她没有说话。';
    const r = attributePronouns(content, ['梁雪吟', '周无极']);
    expect(r.get('梁雪吟')).toBeUndefined();
  });
  it('段级归属后翻转样本充足（真实语料场景：无名句代词占多数）', () => {
    const mk = (pronoun: string, n: number) =>
      Array.from({ length: n }, () => `梁雪吟停下脚步。${pronoun}望向山谷深处。${pronoun}没有再说话。\n`).join('');
    const chapters = [
      { index: 1, content: mk('她', 10) },
      { index: 2, content: mk('她', 10) },
      { index: 4, content: mk('他', 10) },
    ];
    const flips = detectPronounFlip(chapters, ['梁雪吟']);
    expect(flips).toHaveLength(1);
    expect(flips[0].flippedChapters).toEqual([4]);
  });
});
