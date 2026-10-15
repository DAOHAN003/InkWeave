/**
 * chronicleFilterMemo —— 大事记筛选记忆（V9.1.0 跨会话持久化）
 *
 * V8.8.0 的筛选记忆是组件模块级 Map（会话生命周期，切世界重载即清空）。
 * V9.1.0 把同一份记忆落到 localStorage：重启 exe / 切世界再回来，筛选
 * 仍在。设计约束：
 *  - 键 = 实体 id + ':' + name 复合（化解跨世界同 id 串扰）；
 *  - 值 = { imp, type }（type 恢复时经当前实体 typeOptions 校验，失配回退 all）；
 *  - 容量上限 MAX_ENTRIES：超限按最久未更新淘汰（Map 插入序），防无限膨胀；
 *  - 读写全 try/catch：隐私模式 / 数据损坏静默降级为无记忆。
 */

const STORAGE_KEY = 'fuxiloom.chronicleFilterMemo.v1';

/** 记忆容量上限（实体数；超限按最久未更新淘汰） */
export const MAX_ENTRIES = 200;

export interface ChronicleFilterMemoValue {
  imp: string;
  type: string;
}

type MemoStore = Record<string, ChronicleFilterMemoValue>;

/** 读入持久化记忆（模块加载时调用一次；损坏/缺失返回空） */
export function loadChronicleFilterMemo(): MemoStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: MemoStore = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof k === 'string' && k.length > 0 &&
        v && typeof v === 'object' &&
        typeof (v as ChronicleFilterMemoValue).imp === 'string' &&
        typeof (v as ChronicleFilterMemoValue).type === 'string'
      ) {
        out[k] = { imp: (v as ChronicleFilterMemoValue).imp, type: (v as ChronicleFilterMemoValue).type };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 超限淘汰：按 Map 插入序（最久未更新在前）截到容量内（纯函数，导出供单测） */
export function capMemoStore<K extends string, V>(store: Map<K, V>, max: number): Map<K, V> {
  if (store.size <= max) return store;
  const out = new Map<K, V>();
  const skip = store.size - max;
  let i = 0;
  for (const [k, v] of store) {
    if (i++ >= skip) out.set(k, v);
  }
  return out;
}

/** 全量回写（调用方已持有最新 Map；写失败静默） */
export function saveChronicleFilterMemo(store: Map<string, ChronicleFilterMemoValue>): void {
  try {
    const capped = capMemoStore(store, MAX_ENTRIES);
    const obj: MemoStore = {};
    for (const [k, v] of capped) obj[k] = v;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    /* 隐私模式 / 配额满：静默降级为会话级记忆 */
  }
}
