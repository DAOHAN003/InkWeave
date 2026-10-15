/**
 * 离线中文校对（Phase 4）— 纯函数、零依赖、可在 node 下单测。
 *
 * 不依赖任何外部服务（LanguageTool 需本地/远程服务器，本项目未装），
 * 这里覆盖高频、高置信度的静态检查：
 *   1. 重复字词（"的的"、"研究研究"）
 *   2. 常见错别字固定搭配（"好象"→"好像"、"既"→"即" 等）
 *   3. 中英文标点混用（CJK 后接半角 ,.!?;:）
 *   4. CJK 之间的多余半角空格（"中文 空格 中文"）
 *
 * 返回带上下文片段的问题列表，供校对面板展示。
 */

export type ProofreadType = 'repeat' | 'typo' | 'punct' | 'space';

export interface ProofreadIssue {
  type: ProofreadType;
  message: string;
  /** 问题上下文片段（含前后若干字） */
  context: string;
  /** 建议修正（可选） */
  suggestion?: string;
}

/** 常见错别字固定搭配（高置信度，仅标记明确错误的写法） */
const TYPO_DICT: Array<{ wrong: string; right: string; note?: string }> = [
  { wrong: '好象', right: '好像' },
  { wrong: '即然', right: '既然' },
  { wrong: '在见', right: '再见' },
  { wrong: '烦脑', right: '烦恼' },
  { wrong: '按排', right: '安排' },
  { wrong: '布署', right: '部署' },
  { wrong: '穿流不息', right: '川流不息' },
  { wrong: '默守成规', right: '墨守成规' },
  { wrong: '一愁莫展', right: '一筹莫展' },
  { wrong: '迫不急待', right: '迫不及待' },
  { wrong: '既往不咎', right: '既往不咎' },
  { wrong: '一如继往', right: '一如既往' },
  { wrong: '草管人命', right: '草菅人命' },
  { wrong: '美仑美奂', right: '美轮美奂' },
  { wrong: '入场卷', right: '入场券' },
  { wrong: '弦律', right: '旋律' },
  { wrong: '精萃', right: '精粹' },
  { wrong: '松驰', right: '松弛' },
  { wrong: '震憾', right: '震撼' },
  { wrong: '沉缅', right: '沉湎' },
];

const CJK = '一-鿿㐀-䶿豈-﫿';

/**
 * 常见合法叠词 / 动词重叠白名单（中文里"天天""慢慢""研究研究"是正确用法，
 * 不能当错别字报）。只有不在白名单里的重复才视为疑似错误。
 */
const REDUP_OK = new Set<string>([
  // 叠字形容词 / 副词
  '天天', '慢慢', '常常', '处处', '人人', '年年', '月月', '日日', '谢谢', '问问', '看看', '想想',
  '说说', '试试', '连连', '刚刚', '纷纷', '暗暗', '偷偷', '悄悄', '渐渐', '偏偏', '明明', '单单',
  '仅仅', '恰恰', '好好', '远远', '迟迟', '累累', '滚滚', '茫茫', '苍苍', '皑皑', '蒙蒙', '潺潺',
  '洋洋', '依依', '栩栩', '彬彬', '楚楚', '津津', '孜孜', '炯炯', '奄奄', '鼎鼎', '赫赫', '滔滔',
  '源源', '欣欣', '蒸蒸', '井井', '窃窃', '默默', '落落', '耿耿', '区区', '咄咄', '亭亭', '婷婷',
  '谆谆', '循循', '娓娓', '喋喋', '侃侃', '盈盈', '翩翩', '忡忡', '惺惺', '徐徐', '悠悠', '冉冉',
  '苒苒', '斑斑', '点点', '滴滴', '丝丝', '缕缕', '阵阵', '朵朵', '片片', '条条', '根根', '枝枝',
  '叶叶', '棵棵', '匹匹', '个个', '件件', '桩桩', '样样', '种种', '台台', '辆辆', '艘艘', '间间',
  '户户', '家家', '村村', '镇镇', '校校', '班班', '队队', '组组', '排排', '行行', '列列', '张张',
  '本本', '页页', '篇篇', '句句', '字字', '声声', '道道',
  // 动词重叠（ABAB）
  '研究', '商量', '讨论', '思考', '学习', '锻炼', '休息', '参观', '体验', '感受', '了解', '分析',
  '检查', '整理', '打扫', '清洗', '修理', '打扮', '放松', '开心', '高兴', '热闹', '清醒', '明白',
  '清楚', '安静', '干净', '凉快', '暖和', '轻松', '舒服', '痛快', '活动', '运动', '练习', '复习',
  '预习', '准备', '收拾', '张罗', '打量', '琢磨', '合计', '盘算', '掂量', '思量', '比划', '商量',
]);

function snippet(text: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 8);
  const end = Math.min(text.length, idx + len + 8);
  const pre = start > 0 ? '…' : '';
  const post = end < text.length ? '…' : '';
  return pre + text.slice(start, end) + post;
}

/** 对单段正文做离线校对，返回问题列表（按出现顺序）。 */
export function proofreadText(text: string): ProofreadIssue[] {
  const issues: ProofreadIssue[] = [];
  if (!text) return issues;

  // 1) 重复单字："(字)(字)" 紧邻。3 个及以上相同字必为错误；2 个相同需排除合法叠词。
  const reSingle = new RegExp('([' + CJK + '])\\1', 'g');
  let m: RegExpExecArray | null;
  while ((m = reSingle.exec(text)) !== null) {
    const pair = m[1] + m[1];
    if (m.index + 2 < text.length && text[m.index + 2] === m[1]) {
      // 连续 3 个相同字：必为错误（中文无 3 字叠词）
      issues.push({
        type: 'repeat',
        message: `疑似重复字词：「${m[1]}${m[1]}${m[1]}」`,
        context: snippet(text, m.index, 2),
      });
      reSingle.lastIndex = m.index + 3;
      continue;
    }
    if (REDUP_OK.has(pair)) continue; // 合法叠词（天天/慢慢…）跳过
    issues.push({
      type: 'repeat',
      message: `疑似重复字词：「${pair}」`,
      context: snippet(text, m.index, 1),
    });
  }

  // 2) 重复双字及以上词："ABAB"。动词重叠（研究研究）是正确用法，需排除。
  const reWord = new RegExp('([' + CJK + ']{2,4})\\1', 'g');
  while ((m = reWord.exec(text)) !== null) {
    if (REDUP_OK.has(m[1])) continue;
    issues.push({
      type: 'repeat',
      message: `疑似重复词语：「${m[1]}${m[1]}」`,
      context: snippet(text, m.index, m[1].length * 2),
    });
  }

  // 3) 常见错别字固定搭配
  for (const t of TYPO_DICT) {
    let from = 0;
    while (true) {
      const i = text.indexOf(t.wrong, from);
      if (i < 0) break;
      issues.push({
        type: 'typo',
        message: `疑似错别字：「${t.wrong}」应为「${t.right}」`,
        context: snippet(text, i, t.wrong.length),
        suggestion: t.right,
      });
      from = i + t.wrong.length;
    }
  }

  // 4) 中英文标点混用：CJK 后接半角 ,.!?;:
  const rePunct = new RegExp('([' + CJK + '])([,.!?;:])', 'g');
  while ((m = rePunct.exec(text)) !== null) {
    const map: Record<string, string> = {
      ',': '，',
      '.': '。',
      '!': '！',
      '?': '？',
      ';': '；',
      ':': '：',
    };
    const half = m[2];
    issues.push({
      type: 'punct',
      message: `中英文标点混用：CJK 后应为全角「${map[half]}」而非半角「${half}」`,
      context: snippet(text, m.index, 1),
      suggestion: map[half],
    });
  }

  // 5) CJK 之间的多余半角空格
  const reSpace = new RegExp('([' + CJK + ']) ([ ' + CJK + '])', 'g');
  while ((m = reSpace.exec(text)) !== null) {
    issues.push({
      type: 'space',
      message: '中文之间不应有半角空格',
      context: snippet(text, m.index, 1),
    });
  }

  // 按出现位置排序
  return issues;
}

export interface ChapterProof {
  chapterId: string;
  title: string;
  issues: ProofreadIssue[];
}

/** 对整部作品逐章校对，返回有问题的章节（无问题章节不返回）。 */
export function proofreadNovel(novel: {
  volumes: Array<{ title?: string; chapters: Array<{ id: string; title?: string; content?: string }> }>;
}): ChapterProof[] {
  const result: ChapterProof[] = [];
  novel.volumes.forEach((vol, vi) => {
    const volTitle = (vol.title ?? '').trim() || `第${vi + 1}卷`;
    vol.chapters.forEach((ch, ci) => {
      const issues = proofreadText(ch.content ?? '');
      if (issues.length > 0) {
        result.push({
          chapterId: ch.id,
          title: `${volTitle} · ${(ch.title ?? '').trim() || `第${ci + 1}章`}`,
          issues,
        });
      }
    });
  });
  return result;
}
