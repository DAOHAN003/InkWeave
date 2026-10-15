/**
 * 世界题材元数据 + 世界圣经 JSON 提取（V8.4.0 巨石治理第三刀，自 WorldBuilderPanel.tsx 拆出）。
 * 面板与域 hooks（useNovelWorldSuite / useWanxiangWorld）共用。
 */

export type WorldTypeMeta = {
  value: string;
  label: string;
  energy: string;
  feature: string;
  battleRate: string;
};

export const WORLD_TYPES: WorldTypeMeta[] = [
  { value: 'xianxia',   label: '仙侠',   energy: '灵力/仙元',   feature: '渡劫飞升、宗门秘境',        battleRate: '高' },
  { value: 'wuxia',     label: '武侠',   energy: '内力/真气',   feature: '江湖恩怨、门派争斗',        battleRate: '高' },
  { value: 'xuanhuan',  label: '玄幻',   energy: '玄力/血脉',   feature: '异界大陆、万族争霸',        battleRate: '极高' },
  { value: 'fantasy',   label: '奇幻',   energy: '魔力/咒力',   feature: '剑与魔法、异世界冒险',      battleRate: '中' },
  { value: 'scifi',     label: '科幻',   energy: '科技/算力',   feature: '星际航行、赛博改造',        battleRate: '中' },
  { value: 'urban',     label: '都市',   energy: '现实/社会',   feature: '现代都市、职场日常',        battleRate: '低' },
  { value: 'history',   label: '历史',   energy: '权谋/军心',   feature: '庙堂权谋、金戈铁马',        battleRate: '中' },
  { value: 'military',  label: '军事',   energy: '军心/战力',   feature: '战役推进、战术推演',        battleRate: '极高' },
  { value: 'apocalypse',label: '末日',   energy: '残存资源',   feature: '废土求生、异种威胁',        battleRate: '高' },
  { value: 'suspense',  label: '悬疑',   energy: '线索/逻辑',   feature: '迷雾真相、层层反转',        battleRate: '低' },
  { value: 'romance',   label: '言情',   energy: '情感/羁绊',   feature: '人物情感、关系推进',        battleRate: '低' },
  { value: 'wendao',    label: '闻道',   energy: '道理/认知',   feature: '悟道修行、理念争锋',        battleRate: '中' },
];

/** 从可能带 ```json 围栏或前后缀文字的返回里抠出 JSON 对象 */
export function extractWorldJson(text: string): Record<string, unknown> | null {
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const tryParse = (str: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(str);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(s);
  if (direct) return direct;
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) {
    const sliced = tryParse(s.slice(first, last + 1));
    if (sliced) return sliced;
  }
  return null;
}
