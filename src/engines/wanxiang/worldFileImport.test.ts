// 世界设定解析的纯逻辑单测。
//
// 这类函数出错不抛异常、只静默产出错误结果：实体名带上整句描述、AI 的字符串数组被整个丢掉、
// 题材识别偏了导致 WorldRules 参数跑偏——tsc 和 build 都抓不到，只能靠单测锁住。
import { describe, it, expect } from 'vitest';
import {
  cleanEntityName,
  normalizeEntities,
  parseJsonSpec,
  parseMdSpec,
  detectGenre,
  extractSpecJson,
  linkCharactersToFactions,
} from './worldFileImport';

describe('cleanEntityName', () => {
  it('剥离 Markdown 强调与描述后缀', () => {
    expect(cleanEntityName('**青云门**：东域第一大宗')).toBe('青云门');
    expect(cleanEntityName('- 青云门')).toBe('- 青云门'); // 列表符号由调用方先剥
    expect(cleanEntityName('1. 青云门')).toBe('青云门');
    expect(cleanEntityName('【青云门】')).toBe('青云门');
    expect(cleanEntityName('青云门（东域）')).toBe('青云门');
    expect(cleanEntityName('青云门 - 东域第一大宗')).toBe('青云门');
  });

  it('保留名字里的半角连字符', () => {
    expect(cleanEntityName('圣-骑士团')).toBe('圣-骑士团');
  });

  it('整句话不算实体名', () => {
    expect(cleanEntityName('这是一个描述非常长的句子用来测试超过二十四个字符的情况')).toBe('');
  });
});

describe('normalizeEntities', () => {
  it('接受字符串数组（AI 常见输出）', () => {
    expect(normalizeEntities(['青云门', '天剑阁'])).toEqual([
      { name: '青云门' },
      { name: '天剑阁' },
    ]);
  });

  it('接受对象数组并支持中文键', () => {
    expect(normalizeEntities([{ 名称: '青云门' }, { name: '万剑宗' }])).toEqual([
      { name: '青云门' },
      { name: '万剑宗' },
    ]);
  });

  it('去重并丢弃空名与非字符串/对象项', () => {
    expect(normalizeEntities(['青云门', '青云门', '', null, 123])).toEqual([{ name: '青云门' }]);
  });

  it('非数组输入返回空数组', () => {
    expect(normalizeEntities(undefined)).toEqual([]);
    expect(normalizeEntities({ a: 1 })).toEqual([]);
  });
});

describe('parseMdSpec', () => {
  const md = [
    '# 我的世界',
    '## 主要势力',
    '- **青云门**：东域第一大宗',
    '- 万剑宗',
    '## 关键人物',
    '1. 林动（青云门弟子）',
    '2. 萧炎',
    '## 重要地点',
    '- 落云海',
  ].join('\n');

  it('按标题分段抽取实体并清洗名字', () => {
    const spec = parseMdSpec(md);
    expect(spec.factions?.map((f) => f.name)).toEqual(['青云门', '万剑宗']);
    expect(spec.characters?.map((c) => c.name)).toEqual(['林动', '萧炎']);
    expect(spec.locations?.map((l) => l.name)).toEqual(['落云海']);
  });

  it('合并多个同类标题的条目', () => {
    const spec = parseMdSpec('## 主要势力\n- 青云门\n## 其他势力\n- 万剑宗\n');
    expect(spec.factions?.map((f) => f.name)).toEqual(['青云门', '万剑宗']);
  });

  it('无可识别标题时不产出实体', () => {
    const spec = parseMdSpec('随便写点什么，没有任何标题和列表。');
    expect(spec.factions).toEqual([]);
    expect(spec.characters).toEqual([]);
  });
});

describe('parseJsonSpec', () => {
  it('归一化 spec 形状直通', () => {
    const spec = parseJsonSpec(
      JSON.stringify({
        genre: 'scifi',
        factions: [{ name: '联邦', resource: 500 }],
        characters: [{ name: '阿丘', faction: '联邦', power: 120 }],
      }),
    );
    expect(spec.genre).toBe('scifi');
    expect(spec.factions).toEqual([{ resource: 500, name: '联邦' }]);
    expect(spec.characters?.[0].power).toBe(120);
  });

  it('把字符串数组形态的势力救回来（否则会整体丢失）', () => {
    const spec = parseJsonSpec(JSON.stringify({ factions: ['青云门', '万剑宗'] }));
    expect(spec.factions?.map((f) => f.name)).toEqual(['青云门', '万剑宗']);
  });

  it('解析 AI 世界圣经形状', () => {
    const spec = parseJsonSpec(
      JSON.stringify({
        核心设定: '一个星际殖民的科幻世界',
        主要势力: [{ 名称: '地球联邦' }],
        关键人物: [{ 名称: '张三', 身份: '地球联邦舰队指挥官' }],
        重要地点: [{ 名称: '火星港', 描述: '轨道要塞' }],
      }),
    );
    expect(spec.genre).toBe('scifi');
    expect(spec.factions?.[0].name).toBe('地球联邦');
    // 身份含势力名 → 挂靠成功
    expect(spec.characters?.[0].faction).toBe('地球联邦');
    expect(spec.locations?.[0].environment).toBe('轨道要塞');
  });

  it('非法 JSON 退化为仅题材', () => {
    const spec = parseJsonSpec('这不是 JSON，是仙侠设定');
    expect(spec.genre).toBe('xianxia');
    expect(spec.factions).toBeUndefined();
  });
});

describe('linkCharactersToFactions', () => {
  it('对不上的身份被清空，避免 Rust 侧无效查表', () => {
    const chars = [{ name: 'A', faction: '不存在的门派' }];
    linkCharactersToFactions(chars, [{ name: '青云门' }]);
    expect(chars[0].faction).toBeUndefined();
  });

  it('模糊包含也能挂靠', () => {
    const chars = [{ name: 'A', faction: '青云门长老' }];
    linkCharactersToFactions(chars, [{ name: '青云门' }]);
    expect(chars[0].faction).toBe('青云门');
  });
});

describe('detectGenre', () => {
  it('识别到引擎显式支持的题材串', () => {
    expect(detectGenre('渡劫飞升的修仙世界')).toBe('xianxia');
    expect(detectGenre('江湖内力恩怨')).toBe('wuxia');
    expect(detectGenre('丧尸横行的废土')).toBe('apocalypse');
    expect(detectGenre('星际赛博改造')).toBe('scifi');
    expect(detectGenre('剑与魔法的大陆')).toBe('western');
    expect(detectGenre('毫无线索的一段话')).toBe('custom');
  });
});

describe('extractSpecJson', () => {
  it('剥离 ```json 围栏', () => {
    expect(extractSpecJson('```json\n{"genre":"scifi"}\n```')).toEqual({ genre: 'scifi' });
  });

  it('从前后有废话的回复里截出对象', () => {
    expect(extractSpecJson('好的，结果如下：{"genre":"urban"} 以上。')).toEqual({ genre: 'urban' });
  });

  it('无法解析时返回 null', () => {
    expect(extractSpecJson('完全没有 JSON')).toBeNull();
  });
});
