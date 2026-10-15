/**
 * extractEmotionTags 确定性单测：情感标签 + PAD 三维启发式。
 * 与项目铁律一致：同输入恒定输出；词典/阈值行为用断言锁死（注释不可信）。
 */
import { describe, it, expect } from 'vitest';
import { extractEmotionTags } from './emotionTags';

describe('extractEmotionTags（本地确定性启发式）', () => {
  it('无情感词 → 空标签 + 零 PAD', () => {
    const r = extractEmotionTags('他走向山门，看见晨雾里有人影。');
    expect(r.tags).toEqual([]);
    expect(r.pad).toEqual([0, 0, 0]);
  });

  it('愤怒文本 → 怒标签 + 负效价/高唤醒/正向主导', () => {
    const r = extractEmotionTags('他愤怒地砸碎了桌子，怒火在胸腔里燃烧。');
    expect(r.tags).toContain('怒');
    expect(r.pad[0]).toBeLessThan(0); // valence 负
    expect(r.pad[1]).toBeGreaterThan(0.3); // arousal 高
    expect(r.pad[2]).toBeGreaterThan(0); // dominance 正向
  });

  it('开心文本 → 喜标签 + 正效价', () => {
    const r = extractEmotionTags('她开心地笑了，心里满是欢喜。');
    expect(r.tags).toContain('喜');
    expect(r.pad[0]).toBeGreaterThan(0);
  });

  it('悲伤文本 → 悲标签 + 负效价/负向主导', () => {
    const r = extractEmotionTags('他哭了，绝望地跌坐在地上。');
    expect(r.tags).toContain('悲');
    expect(r.pad[0]).toBeLessThan(0);
    expect(r.pad[2]).toBeLessThan(0);
  });

  it('多标签按命中数取 top 2（确定性：并列按词表声明顺序）', () => {
    // 怒×2 + 惊×1 → top 2 = [怒, 惊]
    const r = extractEmotionTags('他愤怒地怒吼，又惊又怒，全场震惊。');
    expect(r.tags).toHaveLength(2);
    expect(r.tags[0]).toBe('怒');
  });

  it('感叹号密集 → arousal 上抬', () => {
    const calm = extractEmotionTags('她笑了。');
    const loud = extractEmotionTags('她笑了！！！！！');
    expect(loud.pad[1]).toBeGreaterThanOrEqual(calm.pad[1]);
  });

  it('空文本 → 空结果', () => {
    expect(extractEmotionTags('')).toEqual({ tags: [], pad: [0, 0, 0] });
    expect(extractEmotionTags('   ')).toEqual({ tags: [], pad: [0, 0, 0] });
  });

  it('确定性：同文本两次抽取结果完全一致', () => {
    const t = '他愤怒地砸碎桌子，又惊又怕，最后绝望地哭了。';
    expect(extractEmotionTags(t)).toEqual(extractEmotionTags(t));
  });
});
