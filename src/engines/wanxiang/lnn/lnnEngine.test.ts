import { describe, it, expect } from 'vitest';
import { extractFeatures, FEATURE_NAMES } from './featureExtractor';
import { runLnnModel, type LnnModel } from './lnnModel';
import { lnnNovelStyleReport, AI_SCORE_FLAG_THRESHOLD } from './index';
import aiScoreModel from './models/ai_score.json';
import tensionGuardModel from './models/tension_guard.json';
import styleModulatorModel from './models/style_modulator.json';

const aiScore = aiScoreModel as unknown as LnnModel;
const tensionGuard = tensionGuardModel as unknown as LnnModel;
const styleModulator = styleModulatorModel as unknown as LnnModel;

// 与 scripts/probe_models.py 完全一致的样本
const HUMAN = [
  '她没说话。\n过了很久。\n“你走吧。”她轻声说。\n窗外的雨还在下。……\n他忽然笑了。\n“傻子。”\n风把灯吹灭了。',
  '我回头看了一眼。\n巷子空空的。\n“别跟着我。”\n脚步声停了。\n……其实我有点怕。',
];
const AI = [
  '然而，这个决定最终导致了极为复杂的后果，因此我们不得不重新审视整个问题。而且，与此同时，另一个重要的因素也开始逐渐显现，并且深刻地改变了整个格局。总之，尽管面临诸多困难，我们依然必须坚定地朝着正确的方向前进。',
  '首先，需要明确的是，这一现象本质上反映了某种深层次的结构性矛盾。其次，从发展的角度来看，相关的变量之间存在着极其密切的关联。最后，基于上述分析，我们可以得出一个相当清晰的结论。',
];

// Python probe 精确 golden（round 4）
const GOLDEN = {
  ai_score: { H0: -0.0106, H1: -0.014, A0: 0.8692, A1: 0.9461 },
  tension_guard: {
    H0: [0.0136, 0.1455],
    H1: [-0.0236, 0.1295],
    A0: [0.1984, 0.3309],
    A1: [0.256, 0.4603],
  },
  style_modulator: {
    H0: [-0.0949, 0.1459, -0.2398, -0.2241, 0.1719, 0.1848, -0.1042, 0.4086],
    H1: [-0.072, 0.1351, -0.2191, -0.2118, 0.1643, 0.2209, -0.0976, 0.4632],
    A0: [-0.7682, -0.5101, -0.038, 0.2921, 0.5038, 0.1881, 0.1103, 0.2704],
    A1: [-0.5279, -0.5706, -0.0144, 0.2935, 0.4747, 0.2714, 0.1677, 0.3389],
  },
};

const close = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

describe('LNN 推理引擎（对齐 Python probe golden）', () => {
  it('特征提取产出 16 维且区间受控', () => {
    const f = extractFeatures(HUMAN[0]);
    expect(f.length).toBe(16);
    expect(FEATURE_NAMES.length).toBe(16);
    for (const v of f) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeLessThanOrEqual(1.5);
    }
  });

  it('ai_score 与 Python golden 一致（人写≈0，AI写≈0.9）', () => {
    expect(close(runLnnModel(aiScore, extractFeatures(HUMAN[0]))[0], GOLDEN.ai_score.H0)).toBe(true);
    expect(close(runLnnModel(aiScore, extractFeatures(HUMAN[1]))[0], GOLDEN.ai_score.H1)).toBe(true);
    expect(close(runLnnModel(aiScore, extractFeatures(AI[0]))[0], GOLDEN.ai_score.A0)).toBe(true);
    expect(close(runLnnModel(aiScore, extractFeatures(AI[1]))[0], GOLDEN.ai_score.A1)).toBe(true);
  });

  it('tension_guard 与 Python golden 一致', () => {
    const h0 = runLnnModel(tensionGuard, extractFeatures(HUMAN[0]));
    const a0 = runLnnModel(tensionGuard, extractFeatures(AI[0]));
    expect(close(h0[0], GOLDEN.tension_guard.H0[0])).toBe(true);
    expect(close(h0[1], GOLDEN.tension_guard.H0[1])).toBe(true);
    expect(close(a0[0], GOLDEN.tension_guard.A0[0])).toBe(true);
    expect(close(a0[1], GOLDEN.tension_guard.A0[1])).toBe(true);
  });

  it('style_modulator 与 Python golden 一致（8 维）', () => {
    const h0 = runLnnModel(styleModulator, extractFeatures(HUMAN[0]));
    const a0 = runLnnModel(styleModulator, extractFeatures(AI[0]));
    expect(h0.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(close(h0[i], GOLDEN.style_modulator.H0[i])).toBe(true);
      expect(close(a0[i], GOLDEN.style_modulator.A0[i])).toBe(true);
    }
  });

  it('lnnNovelStyleReport 三模型分离：AI写 ai_score 显著高于人写且超阈值', () => {
    const human = lnnNovelStyleReport(HUMAN[0]);
    const ai = lnnNovelStyleReport(AI[0]);
    expect(human.aiScore).toBeLessThan(AI_SCORE_FLAG_THRESHOLD);
    expect(ai.aiScore).toBeGreaterThan(AI_SCORE_FLAG_THRESHOLD);
    expect(ai.aiScore - human.aiScore).toBeGreaterThan(0.5);
    expect(human.tension.length).toBe(2);
    expect(human.styleDelta.length).toBe(8);
  });

  it('空文本安全返回零向量', () => {
    const r = lnnNovelStyleReport('');
    expect(r.features.every((v) => v === 0)).toBe(true);
    expect(Number.isFinite(r.aiScore)).toBe(true);
  });
});
