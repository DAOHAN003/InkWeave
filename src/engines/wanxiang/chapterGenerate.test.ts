import { describe, it, expect } from 'vitest';
import { stripMeta, acceptRevision, formatCharacterContext, composeWorldDataBlock } from './chapterGenerate';

/**
 * 审校 pass 采纳守门的回归锁。
 *
 * 守的是一类真实数据损坏：多 pass 审校旧实现只判「返回非空」就覆盖正文，
 * 模型截断 / 超时半截返回 / 拒答 / 把上下文一并吐出时，整章正文会被残稿冲掉且用户无感。
 * 阈值一旦被人「顺手放宽」，故障会重新变得静默 —— 所以临界值必须钉死在测试里。
 */

const CH = (n: number) => '文'.repeat(n);

describe('composeWorldDataBlock — 万象世界数据注入', () => {
  it('空/undefined/null/纯空白 → 空串（不污染 prompt）', () => {
    expect(composeWorldDataBlock(undefined)).toBe('');
    expect(composeWorldDataBlock(null)).toBe('');
    expect(composeWorldDataBlock('')).toBe('');
    expect(composeWorldDataBlock('   \n  ')).toBe('');
  });

  it('有值 → 带权威声明 header，模型能识别数据来源与地位', () => {
    const block = composeWorldDataBlock('势力：玄天宗（掌门：李长青）');
    expect(block).toContain('万象确定性模拟产出');
    expect(block).toContain('事实权威');
    expect(block).toContain('玄天宗');
  });

  it('前后空白被 trim，不产生畸形换行', () => {
    const block = composeWorldDataBlock('  事件：灵潮再临  \n ');
    expect(block.startsWith('\n\n── 世界数据')).toBe(true);
    expect(block.endsWith('灵潮再临')).toBe(true);
  });

  it('maxChars 截断（分析步用截断版防 prompt 膨胀）', () => {
    const block = composeWorldDataBlock(CH(3000), 2500);
    expect(block.length).toBeLessThan(3000);
    expect(block).toContain('万象确定性模拟产出');
  });

  it('未传 maxChars 不截断（叙述/融合步用完整版）', () => {
    const body = CH(3000);
    const block = composeWorldDataBlock(body);
    expect(block).toContain(body);
  });
});

describe('stripMeta', () => {
  it('剥离整段代码围栏', () => {
    expect(stripMeta('```\n正文内容\n```')).toBe('正文内容');
    expect(stripMeta('```markdown\n正文内容\n```')).toBe('正文内容');
  });

  it('剥离单层元话语开场白', () => {
    expect(stripMeta('好的，以下是润色后的正文：\n真正的正文')).toBe('真正的正文');
    expect(stripMeta('以下是修改稿\n真正的正文')).toBe('真正的正文');
  });

  it('剥离叠加的双层开场白', () => {
    expect(stripMeta('好的。\n以下是润色后的正文：\n真正的正文')).toBe('真正的正文');
  });

  it('最多剥两层，第三层保留（避免过度吞正文）', () => {
    const out = stripMeta('好的。\n收到。\n明白了。\n真正的正文');
    expect(out).toContain('真正的正文');
    expect(out.startsWith('明白了')).toBe(true);
  });

  it('正常正文不被误伤', () => {
    const body = '他推开门，风雪灌了进来。\n\n远处传来钟声。';
    expect(stripMeta(body)).toBe(body);
  });

  it('空输入与 falsy 输入安全', () => {
    expect(stripMeta('')).toBe('');
    expect(stripMeta('   \n  ')).toBe('');
  });
});

describe('acceptRevision — 拒绝路径', () => {
  it('返回为空 → 拒绝并保留原文', () => {
    const before = CH(500);
    const r = acceptRevision(before, '');
    expect(r.accepted).toBe(false);
    expect(r.text).toBe(before);
    expect(r.reason).toBe('返回为空');
  });

  it('只有空白 → 拒绝', () => {
    expect(acceptRevision(CH(500), '   \n\n  ').accepted).toBe(false);
  });

  it('模型拒答且不足半篇 → 拒绝', () => {
    const r = acceptRevision(CH(500), '抱歉，我无法完成这个请求。');
    expect(r.accepted).toBe(false);
    expect(r.reason).toBe('模型拒答');
  });

  it('疑似截断：59% 不足六成 → 拒绝', () => {
    const before = CH(200);
    const r = acceptRevision(before, CH(118)); // 118/200 = 59%
    expect(r.accepted).toBe(false);
    expect(r.reason).toContain('疑似截断');
    expect(r.text).toBe(before);
  });

  it('异常膨胀：300% 超过 2.5 倍 → 拒绝（疑似混入上下文）', () => {
    const before = CH(200);
    const r = acceptRevision(before, CH(600));
    expect(r.accepted).toBe(false);
    expect(r.reason).toContain('异常膨胀');
    expect(r.text).toBe(before);
  });
});

describe('acceptRevision — 采纳路径', () => {
  it('临界值：61% 达到六成 → 采纳', () => {
    const r = acceptRevision(CH(200), CH(122)); // 122/200 = 61%
    expect(r.accepted).toBe(true);
    expect(r.text.length).toBe(122);
  });

  it('正常润色（长度相近）→ 采纳', () => {
    const r = acceptRevision(CH(500), CH(520));
    expect(r.accepted).toBe(true);
    expect(r.reason).toBe('');
  });

  it('2.5 倍边界内的合理扩写 → 采纳', () => {
    expect(acceptRevision(CH(200), CH(500)).accepted).toBe(true);
  });

  it('短稿（<200 字）豁免比例守门 —— 短文本波动大，比例无意义', () => {
    const r = acceptRevision(CH(100), CH(10));
    expect(r.accepted).toBe(true);
    expect(r.text.length).toBe(10);
  });

  it('采纳时写回的是剥离元话语后的干净正文', () => {
    const r = acceptRevision(CH(300), `好的，以下是润色后的正文：\n${CH(300)}`);
    expect(r.accepted).toBe(true);
    expect(r.text).toBe(CH(300));
    expect(r.text.startsWith('好的')).toBe(false);
  });

  it('含拒答措辞但篇幅完整 → 仍采纳（正文里出现"我无法"是合法剧情台词）', () => {
    const body = `我无法接受这个结果。${CH(500)}`;
    const r = acceptRevision(CH(500), body);
    expect(r.accepted).toBe(true);
  });
});

/**
 * 角色一致性上下文的注入不变量。
 *
 * 守的是一类真实失效（2026-09-16 发现）：声音锁定与成长弧光两块曾只进部分起草路径 ——
 * 声音锁定漏了「叙述框架」与「融合」步；成长弧光更极端，**只进了「场景分析失败」的降级路径**，
 * 正常六步 / 极简 / 连写全部漏喂。两者都不会报错（块为空时静默跳过），
 * 所以同一份角色设定在不同模式下时灵时不灵，用户只会觉得"AI 偶尔不听话"。
 *
 * 这两块现在必须经同一个函数注入，本测试钉住「要么都给、要么都不给」。
 */
describe('formatCharacterContext — 角色一致性上下文', () => {
  it('两块都为空 → 返回空串（不污染 prompt）', () => {
    expect(formatCharacterContext('', '')).toBe('');
  });

  it('只有声音锁定时仍注入（弧光为空不该连带丢掉声音锁定）', () => {
    const out = formatCharacterContext('【角色声音】甲：口癖「罢了」', '');
    expect(out).toContain('角色声音');
    expect(out).not.toContain('成长轨迹');
  });

  it('只有弧光时仍注入（声音锁定为空不该连带丢掉弧光）', () => {
    const out = formatCharacterContext('', '【角色成长轨迹】甲：第1章 拜师');
    expect(out).toContain('成长轨迹');
  });

  it('两块同时存在 → 都注入，且声音锁定在前', () => {
    const out = formatCharacterContext('【角色声音】甲', '【角色成长轨迹】甲');
    expect(out).toContain('角色声音');
    expect(out).toContain('成长轨迹');
    expect(out.indexOf('角色声音')).toBeLessThan(out.indexOf('成长轨迹'));
  });

  it('块之间以 \\n\\n 分隔（避免与上一段 prompt 粘连）', () => {
    const out = formatCharacterContext('声音块', '弧光块');
    expect(out.startsWith('\n\n')).toBe(true);
    expect(out).toContain('\n\n弧光块');
  });
});
