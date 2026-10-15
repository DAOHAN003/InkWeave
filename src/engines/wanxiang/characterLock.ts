/**
 * 轻量角色锁（character lock）—— 灵明 character_lock 思想的落地
 *
 * 问题：原 OOC 守门只靠 6 个抽象特质锚点（勇敢/胆小/善良/冷酷/聪明/鲁莽），
 * 角色 personality 没命中词库就直接跳过检测——结果角色"串味"（A 的口吻跑到 B 嘴里）、
 * 角色说出与其人设矛盾的话，守门抓不到。这正是灵明审计里 character_lock 缺口的现实形态。
 *
 * 本模块做两件零 LLM 的事（与项目铁律一致：检测全本地、只有修复耗 token）：
 *  1. formatCharacterVoiceBlock —— 把每个角色的「语气 / 口癖 / 禁用言行」编成 prompt 注入段，
 *     让 LLM 起草/写对话时有明确、可执行的"声音约束"（生成端预防，对应灵明"锁声音"）。
 *  2. detectVoiceLock —— 对已生成正文做确定性守门：
 *     - 禁用言行：角色在自己引号对话段里说出 forbiddenSpeech → 违规；
 *     - 口癖外泄：角色 A 的 speechHabit 出现在角色 B 的引号对话段里 → 串味违规。
 *     只解析「角色名「对话」」型引号对话（模型被指令用「」标注说话人），避免误伤叙述正文。
 *
 * 设计边界（诚实）：
 *  - 仅检查"引号对话段 + 说话人是已知角色名"的情形；叙述里的旁白口吻不在本锁范围
 *    （那是 lint / OOC 特质守门的职责）。
 *  - 角色未填 voiceTone/speechHabit/forbiddenSpeech 时，该角色不参与本锁（向后兼容旧数据）。
 *  - 纯函数、无 Tauri/Rust 依赖，可单测锁死。
 */

import type { Character } from '../../types/novel';

/** 一条声音锁违规 */
export interface VoiceLockIssue {
  /** 违规发生的角色（说话人） */
  character: string;
  /** forbidden=说出禁用言行；habit-leak=用了别的角色的口癖（串味） */
  kind: 'forbidden' | 'habit-leak';
  message: string;
}

/** 把多条短语（、，,分隔）拆成数组，去空白、去空串 */
function splitPhrases(input?: string): string[] {
  if (!input) return [];
  return input
    .split(/[、，,；;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 从正文里抽取"每个已知角色名」对话「"的内容。
 * 用最长角色名优先的正则（alternation 按长度降序），减少"小李"匹配到"小李飞刀"的串扰。
 * 仅识别中文「」、英文""、中文""三种引号包裹的语段。
 */
function extractSpeechByCharacter(text: string, names: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const valid = names.filter((n) => n && n.trim());
  if (valid.length === 0 || !text) return map;
  const sorted = [...valid].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${sorted.map(escapeRegExp).join('|')})[「"“]([^」"”]*)[」"”]`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1];
    const speech = m[2];
    if (!map.has(name)) map.set(name, []);
    map.get(name)!.push(speech);
  }
  return map;
}

/**
 * 确定性声音锁检测：返回所有违规（零 LLM）。
 * - 禁用言行：角色在自己对话段说出 forbiddenSpeech 任一条 → forbidden 违规。
 * - 口癖外泄：角色 A 的 speechHabit 任一条出现在角色 B（≠A）的对话段 → habit-leak 违规。
 */
export function detectVoiceLock(text: string, characters: Character[]): VoiceLockIssue[] {
  const issues: VoiceLockIssue[] = [];
  const named = (characters || []).filter((c) => c && c.name);
  if (named.length === 0 || !text) return issues;

  const speechMap = extractSpeechByCharacter(
    text,
    named.map((c) => c.name),
  );

  for (const c of named) {
    const forbidden = splitPhrases(c.forbiddenSpeech);
    const habits = splitPhrases(c.speechHabit);
    if (forbidden.length === 0 && habits.length === 0) continue; // 该角色没配锁，跳过

    const mySpeech = (speechMap.get(c.name) || []).join('\n');

    // 1) 禁用言行：出现在自己对话段
    for (const f of forbidden) {
      if (f && mySpeech.includes(f)) {
        issues.push({
          character: c.name,
          kind: 'forbidden',
          message: `角色「${c.name}」说出禁用言行「${f}」（与角色声音锁定冲突，请改写为符合其人设的表达）`,
        });
      }
    }

    // 2) 口癖外泄：本角色口癖出现在他人对话段（串味）
    for (const h of habits) {
      if (!h) continue;
      for (const d of named) {
        if (d.name === c.name) continue;
        const dSpeech = (speechMap.get(d.name) || []).join('\n');
        if (dSpeech.includes(h)) {
          issues.push({
            character: d.name,
            kind: 'habit-leak',
            message: `角色「${d.name}」使用了角色「${c.name}」的口癖「${h}」，请改为符合「${d.name}」自身语气的表达`,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * 把角色声音锁定编成 prompt 注入段（生成端预防）。
 * 没有任何角色配置锁字段时返回空串（不污染 prompt，向后兼容旧小说）。
 */
export function formatCharacterVoiceBlock(characters: Character[]): string {
  const rows = (characters || [])
    .filter((c) => c && (c.voiceTone || c.speechHabit || c.forbiddenSpeech))
    .map((c) => {
      const parts: string[] = [];
      if (c.voiceTone) parts.push(`语气：${c.voiceTone}`);
      if (c.speechHabit) parts.push(`口癖/招牌句式：${c.speechHabit}`);
      if (c.forbiddenSpeech) parts.push(`禁用言行（绝不会说/做）：${c.forbiddenSpeech}`);
      return `- ${c.name}｜${parts.join('；')}`;
    });
  if (rows.length === 0) return '';
  return (
    '## 角色声音锁定（character lock）\n' +
    rows.join('\n') +
    '\n要求：每个角色说话必须自带辨识度——严格贴合各自「语气」，习惯性使用各自「口癖」，' +
    '且任何角色都不得说出他人「口癖」或自己的「禁用言行」。对话用「」标注说话人。'
  );
}
