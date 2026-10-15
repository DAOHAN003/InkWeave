import { describe, it, expect } from 'vitest';
import { zhSpace, typesetText, typesetNovel } from './zhTypeset';

describe('zhSpace 中文排版', () => {
  it('CJK 后接拉丁字母加空格', () => {
    expect(zhSpace('你好world')).toBe('你好 world');
  });

  it('拉丁字母后接 CJK 加空格', () => {
    expect(zhSpace('abc中文')).toBe('abc 中文');
  });

  it('CJK 后接数字加空格', () => {
    expect(zhSpace('公元2024年')).toBe('公元 2024 年');
  });

  it('已有空格不重复添加', () => {
    expect(zhSpace('你好 world')).toBe('你好 world');
  });

  it('纯中文不变', () => {
    expect(zhSpace('今天天气真好')).toBe('今天天气真好');
  });

  it('typesetText 关闭开关时原样返回', () => {
    expect(typesetText('你好world', { spaceCjkLatin: false })).toBe('你好world');
  });

  it('typesetNovel 逐章应用', () => {
    const n = { volumes: [{ chapters: [{ content: '你好world' }] }] };
    const out = typesetNovel(n as any);
    expect((out.volumes[0].chapters[0] as any).content).toBe('你好 world');
    // 不修改原对象
    expect((n.volumes[0].chapters[0] as any).content).toBe('你好world');
  });
});
