/**
 * 风格预设（stylePreset）单元测试。
 *
 * 覆盖：五档预设数据完整性 / getStylePreset 未知 id / buildStylePresetBlock
 * 格式与空态 / applyStylePresetThresholds 合并语义（预设优先、不碰未给键）。
 */
import { describe, it, expect } from 'vitest';
import {
  STYLE_PRESETS,
  getStylePreset,
  buildStylePresetBlock,
  applyStylePresetThresholds,
  type StylePresetThresholds,
} from './stylePreset';

describe('STYLE_PRESETS 数据完整性', () => {
  it('恰好五档内置预设，id 唯一', () => {
    expect(STYLE_PRESETS).toHaveLength(5);
    const ids = STYLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(5);
  });

  it('每档必填字段非空且 directive 含具体指令', () => {
    for (const p of STYLE_PRESETS) {
      expect(p.id.trim()).toBeTruthy();
      expect(p.label.trim()).toBeTruthy();
      expect(p.desc.trim()).toBeTruthy();
      expect(p.directive.trim().length).toBeGreaterThanOrEqual(40);
    }
  });

  it('阈值覆盖只含合法键且数值在合理区间（与 CLAMPS 对齐）', () => {
    const LEGAL: Array<keyof StylePresetThresholds> = [
      'clicheFailSingle', 'clicheFailTotal', 'clicheWarnTotal',
      'simileWarnPer10k', 'simileFailPer10k', 'thinAbsFloor', 'thinTargetRatio',
    ];
    for (const p of STYLE_PRESETS) {
      for (const key of Object.keys(p.thresholds)) {
        expect(LEGAL).toContain(key as keyof StylePresetThresholds);
      }
      if (p.thresholds.simileFailPer10k !== undefined) {
        expect(p.thresholds.simileFailPer10k).toBeGreaterThanOrEqual(1);
        expect(p.thresholds.simileFailPer10k).toBeLessThanOrEqual(200);
      }
      if (p.thresholds.simileWarnPer10k !== undefined && p.thresholds.simileFailPer10k !== undefined) {
        // warn 必须 < fail（否则永远到不了 warn 就 fail）
        expect(p.thresholds.simileWarnPer10k).toBeLessThan(p.thresholds.simileFailPer10k);
      }
    }
  });

  it('五档明喻上限互有区分（档位真有差异）', () => {
    const fails = STYLE_PRESETS.map((p) => p.thresholds.simileFailPer10k);
    expect(new Set(fails).size).toBeGreaterThan(1);
  });
});

describe('getStylePreset', () => {
  it('按 id 取到预设', () => {
    const p = getStylePreset('xianxia');
    expect(p?.label).toBe('仙侠古雅');
  });

  it('空串 / null / undefined / 未知 id → null', () => {
    expect(getStylePreset('')).toBeNull();
    expect(getStylePreset(null)).toBeNull();
    expect(getStylePreset(undefined)).toBeNull();
    expect(getStylePreset('no-such-preset')).toBeNull();
  });
});

describe('buildStylePresetBlock', () => {
  it('未选预设返回空串（不污染 prompt）', () => {
    expect(buildStylePresetBlock('')).toBe('');
    expect(buildStylePresetBlock(null)).toBe('');
    expect(buildStylePresetBlock('nope')).toBe('');
  });

  it('选中预设返回带标题头的指令块', () => {
    const block = buildStylePresetBlock('xuanyi');
    expect(block).toContain('── 文风预设：悬疑冷硬（必须贯彻）──');
    expect(block).toContain('冷硬派笔法');
    // 以 \n\n 开头（与 styleBlock 拼接约定一致）
    expect(block.startsWith('\n\n')).toBe(true);
  });
});

describe('applyStylePresetThresholds', () => {
  const base = {
    clicheFailSingle: 3,
    clicheFailTotal: 8,
    simileWarnPer10k: 12,
    simileFailPer10k: 24,
    sleepingGap: 8, // 非 preset 键，不应被碰
  };

  it('未选预设原样返回（同引用或等值）', () => {
    expect(applyStylePresetThresholds(base, '')).toEqual(base);
    expect(applyStylePresetThresholds(base, null)).toEqual(base);
  });

  it('预设覆盖显式给出的键，未给的键保持 base', () => {
    const out = applyStylePresetThresholds(base, 'kehuan');
    expect(out.simileFailPer10k).toBe(14); // 预设值
    expect(out.simileWarnPer10k).toBe(6);
    expect(out.clicheFailSingle).toBe(3); // 预设未给 → base 保留
    expect(out.clicheFailTotal).toBe(8);
    expect(out.sleepingGap).toBe(8); // 非法键也不会被塞进来
    expect(Object.keys(out).sort()).toEqual(['clicheFailSingle', 'clicheFailTotal', 'simileFailPer10k', 'simileWarnPer10k', 'sleepingGap']);
  });

  it('不修改 base（纯函数）', () => {
    applyStylePresetThresholds(base, 'xianxia');
    expect(base.simileFailPer10k).toBe(24);
  });
});
