/**
 * 正文「噪音行」判定规则（纯函数，无任何编辑器 / DOM 依赖）
 *
 * 单独成文件的原因：CodeMirror 的 decoration 扩展（editorNoise.ts）需要 DOM，
 * 在 node 环境跑不了单测；判定逻辑本身才是容易写错、也最该被测的部分，
 * 所以把它剥离出来独立测试。
 *
 * 噪音 = AI 生成流程混进正文的非小说内容：
 *   - 本地降级稿警告块
 *   - `## 本章目标` 这类模板小标题
 *   - `*由 FuxiLoom … 不消耗 LLM*` 生成水印
 *   - HTML 注释、纯分隔线
 */

/** 判定一行是否为「噪音行」（模板标记 / 系统提示 / 水印） */
export function isNoiseLine(text: string): boolean {
  const s = text.trim();
  if (!s) return false;

  // 本地降级稿警告块（> ⚠️ **本地降级稿**：…）
  if (s.startsWith('>') && (s.includes('本地降级稿') || s.includes('\u26a0'))) return true;
  // 生成水印（*由 FuxiLoom … 不消耗 LLM*）
  if (s.includes('不消耗 LLM') || s.includes('不消耗LLM')) return true;
  if (/^\*.*FuxiLoom.*\*$/.test(s)) return true;
  // Markdown 模板小标题（## 本章目标 / ## 前情承接 …）
  if (/^#{1,6}\s+\S/.test(s)) return true;
  // HTML 注释
  if (s.startsWith('<!--')) return true;
  // 纯分隔线
  if (/^(-{3,}|\*{3,}|={3,})$/.test(s)) return true;

  return false;
}

/**
 * 从正文中**真正删除**噪音行（用于导出前清理，与编辑器里的视图隐藏不同，这个会改内容）。
 * 连续空行会被压成一个，避免删完留下一片空白。
 */
export function stripNoiseLines(text: string): string {
  const kept = text.split('\n').filter((line) => !isNoiseLine(line));
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
