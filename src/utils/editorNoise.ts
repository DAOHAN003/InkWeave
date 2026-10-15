/**
 * 编辑器降噪扩展（CodeMirror）
 *
 * 解决的问题：AI 生成的正文里混着一堆非小说内容——本地降级稿警告、`## 本章目标`
 * 这类模板小标题、`*由 FuxiLoom 本地确定性引擎生成 · 不消耗 LLM*` 水印、分隔线。
 * 这些东西和正文同色同字号，作者一眼扫过去全是噪音。
 *
 * 处理策略分两级：
 *   1. 默认：整行打 `.fx-noise` —— 浅灰 #6C7283 + 55% 透明 + 缩小字号，存在但不抢视线。
 *   2. 一键隐藏：容器上挂 `data-hide-noise="true"`，CSS 让 `.fx-noise-line` 整行塌陷，
 *      得到纯净正文视图。注意这只是**视图层隐藏**，文档内容一个字都没动，
 *      关掉开关立刻回来。要真正删除请用 stripNoiseLines（noiseRules.ts）。
 *
 * 为什么用 Decoration.line 而不是 mark：整行级别的显示/隐藏最省事，
 * 也不会把一行切成多个 mark 导致光标定位怪异。
 *
 * 判定规则本身在 noiseRules.ts（纯函数、有单测），这里只负责挂到编辑器上。
 */

import { Decoration, ViewPlugin, EditorView } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { isNoiseLine } from './noiseRules';

export { isNoiseLine, stripNoiseLines } from './noiseRules';

const noiseLineDeco = Decoration.line({ class: 'fx-noise fx-noise-line' });

/** 扫描可视区域，给噪音行挂 decoration（只算视口内的行，长文不卡） */
function buildNoiseDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (isNoiseLine(line.text)) {
        builder.add(line.from, line.from, noiseLineDeco);
      }
      if (line.to + 1 <= pos) break; // 防御：空文档时避免死循环
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * 降噪扩展：把模板标记 / 水印行标成 `.fx-noise-line`。
 * 真正的「淡化」与「隐藏」由 themes.css 里的样式规则决定。
 */
export function noiseDecoration(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildNoiseDecorations(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildNoiseDecorations(update.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
