/**
 * 轻量全局事件总线：让 localStorage 持久化的作品数据（世界追踪等）
 * 在写入后能实时通知已挂载的面板刷新，无需重开面板。
 *
 * 设计要点：
 *  - 纯 DOM CustomEvent，无第三方依赖、零副作用；
 *  - 全程守卫 `typeof window === 'undefined'`，node/vitest 环境下静默 no-op；
 *  - 订阅返回取消函数，组件卸载时清理，避免泄漏。
 */

export type NovelDataChangedKind = 'worldTracking' | 'chapter' | 'any';

export interface NovelDataChangedDetail {
  /** 受影响作品 id（按 novelId 隔离） */
  novelId?: string;
  /** 变更类型 */
  kind?: NovelDataChangedKind;
}

const EVT = 'fuxiloom:novelDataChanged';

/** 通知订阅者：某作品数据已变更（写入方调用） */
export function notifyNovelDataChanged(detail: NovelDataChangedDetail = {}): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<NovelDataChangedDetail>(EVT, { detail }));
  } catch {
    /* 极端环境（如 CustomEvent 不可用）忽略 */
  }
}

/**
 * 订阅作品数据变更。回调收到变更详情。
 * 返回取消订阅函数。
 */
export function subscribeNovelDataChanged(cb: (detail: NovelDataChangedDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    try {
      cb((e as CustomEvent<NovelDataChangedDetail>).detail);
    } catch {
      /* 忽略订阅者内部异常，避免中断其他订阅者 */
    }
  };
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}
