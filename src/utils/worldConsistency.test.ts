import { describe, it, expect } from 'vitest';
import { checkWorldConsistency, parseWarPairs, extractFactTerms } from './worldConsistency';

const BRIEF = [
  '世界类型：xianxia',
  '【关键人物】',
  '- 剑尊（无阵营，境界 9，火，存活）',
  '- 魔头（黑渊盟，境界 8，水，陨落）',
  '- 白首生（黑渊盟，境界 6，木，存活）',
  '【进行中的战争】',
  '- 苍梧宗 vs 黑渊盟：夺宝（强度 0.80）',
].join('\n');

describe('checkWorldConsistency 设定一致性裁判', () => {
  it('陨落角色在正文出现 → 警告', () => {
    const issues = checkWorldConsistency('魔头站在山巅，俯瞰众人。', BRIEF);
    expect(issues.some((i) => i.type === 'dead_appears' && i.subject === '魔头')).toBe(true);
  });

  it('存活角色出现不警告', () => {
    const issues = checkWorldConsistency('剑尊一剑破空，白首生避其锋芒。', BRIEF);
    expect(issues.some((i) => i.type === 'dead_appears')).toBe(false);
  });

  it('陨落角色仅在回忆语境出现 → 不误报（回忆杀）', () => {
    const issues = checkWorldConsistency('他回忆起魔头当年在山巅的模样，久久不能平静。', BRIEF);
    expect(issues.some((i) => i.type === 'dead_appears' && i.subject === '魔头')).toBe(false);
  });

  it('陨落角色回忆中却突然当下出场 → 仍警告', () => {
    const issues = checkWorldConsistency('他忆起魔头。忽然魔头推门而入，一掌劈来。', BRIEF);
    expect(issues.some((i) => i.type === 'dead_appears' && i.subject === '魔头')).toBe(true);
  });

  it('战斗"一起冲上去"不再误判为交战方结盟', () => {
    const issues = checkWorldConsistency('苍梧宗与黑渊盟两军对垒，将士一起冲了上去。', BRIEF);
    expect(issues.some((i) => i.type === 'war_alliance_conflict')).toBe(false);
  });

  it('结盟词出现在第三方身上不误判交战方', () => {
    const issues = checkWorldConsistency('苍梧宗与黑渊盟在战场相遇，却见魔头与白首生合作破阵。', BRIEF);
    expect(issues.some((i) => i.type === 'war_alliance_conflict')).toBe(false);
  });

  it('交战势力同场且用合作词 → 警告', () => {
    const issues = checkWorldConsistency('苍梧宗与黑渊盟当众结盟，震惊四座。', BRIEF);
    expect(issues.some((i) => i.type === 'war_alliance_conflict')).toBe(true);
  });

  it('交战势力同场但无合作词 → 不警告（可能是打仗）', () => {
    const issues = checkWorldConsistency('苍梧宗率众攻向黑渊盟，喊杀震天。', BRIEF);
    expect(issues.some((i) => i.type === 'war_alliance_conflict')).toBe(false);
  });

  it('无简报时跳过世界侧检查（不误报）', () => {
    expect(checkWorldConsistency('魔头还活着。', undefined)).toEqual([]);
  });

  it('空文本返回空', () => {
    expect(checkWorldConsistency('', BRIEF)).toEqual([]);
  });

  describe('extraDeadEntities（设定一致性 × 追踪事件交叉校验）', () => {
    it('无简报、仅 extraDeadEntities 也能标记已陨落角色出场', () => {
      const issues = checkWorldConsistency('林惊羽推门而入，一掌劈来。', undefined, ['林惊羽']);
      expect(issues.some((i) => i.type === 'dead_appears' && i.subject === '林惊羽')).toBe(true);
    });

    it('死亡现场本身（含陨落词）不误报为矛盾（避免死亡章节被自指误判）', () => {
      const issues = checkWorldConsistency('林惊羽陨落于山巅，魂归九幽。', undefined, ['林惊羽']);
      expect(issues.some((i) => i.type === 'dead_appears')).toBe(false);
    });

    it('extraDeadEntities 与简报死亡实体合并生效', () => {
      const issues = checkWorldConsistency('剑尊已陨落，林惊羽却推门而入。', BRIEF, ['林惊羽']);
      // 剑尊（简报：存活）不报；林惊羽（追踪陨落）当下出场应报
      expect(issues.some((i) => i.subject === '剑尊')).toBe(false);
      expect(issues.some((i) => i.subject === '林惊羽')).toBe(true);
    });
  });
});

describe('parseWarPairs 解析交战对', () => {
  it('从简报战争行提取双方', () => {
    expect(parseWarPairs(BRIEF)).toEqual([['苍梧宗', '黑渊盟']]);
  });
});

describe('事实否定冲突（2026-08-29 真机验收漏检修复）', () => {
  const FACT = '沈青梧左眼有一道三寸长的疤痕';

  it('extractFactTerms：去掉功能字切成 ≥2 字片段', () => {
    expect(extractFactTerms(FACT)).toContain('疤痕');
    expect(extractFactTerms(FACT).every((t) => t.length >= 2)).toBe(true);
  });

  it('否定式矛盾被检出：事实"左眼有疤" vs 正文"没有什么疤痕"', () => {
    const text = '沈青梧推开窗，晨光落在脸上。他双眼明亮如星，面庞光洁无瑕，从出生到今天没有受过任何伤，自然也没有什么疤痕。师弟们常说，全宗门再找不到第二张这样干净的脸。';
    const issues = checkWorldConsistency(text, undefined, [], [FACT]);
    const hit = issues.find((i) => i.type === 'fact_negation_conflict');
    expect(hit).toBeTruthy();
    expect(hit?.subject).toBe('疤痕');
  });

  it('正常回扣前情不误报：第2章"抚过左眼的疤痕"（无否定词）', () => {
    const text = '第二天清晨，雪停了。沈青梧坐在窗边擦刀，指腹不经意抚过左眼的疤痕，往事又翻上心头。老掌柜端来一碗热粥，低声道：昨夜有人来问你的名字。';
    const issues = checkWorldConsistency(text, undefined, [], [FACT]);
    expect(issues.filter((i) => i.type === 'fact_negation_conflict')).toHaveLength(0);
  });

  it('事实未在正文出现时不报', () => {
    const issues = checkWorldConsistency('他在集市上买了一斤糖葫芦。', undefined, [], [FACT]);
    expect(issues.filter((i) => i.type === 'fact_negation_conflict')).toHaveLength(0);
  });

  it('每条事实只报一次（多处否定不重复刷屏）', () => {
    const text = '他脸上没有疤痕，手上也没有疤痕，光洁得很。';
    const issues = checkWorldConsistency(text, undefined, [], [FACT]);
    expect(issues.filter((i) => i.type === 'fact_negation_conflict')).toHaveLength(1);
  });
});
