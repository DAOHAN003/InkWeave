/**
 * 中文词数统计（全项目唯一实现，V8.9.0 收敛四处内联拷贝）。
 *
 * 口径：中文（含日文假名 / 韩文）按字符计；英文按单词计；忽略空白。
 *
 * 之前 storage / pacingBoard / consistencyCheck / legacySanitizer 各持一份逐字相同的
 * 内联实现（引擎层内联是为了避免把 storage 的 localStorage 副作用拖进测试图）——
 * 本模块零依赖纯函数，四方统一引用，口径改动只改这里。
 */
export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = (text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const ascii = (text.match(/[a-zA-Z][a-zA-Z'-]*/g) || []).length;
  return cjk + ascii;
}
