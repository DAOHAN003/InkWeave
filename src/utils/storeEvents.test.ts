import { describe, it, expect, beforeEach } from 'vitest';
import {
  notifyNovelDataChanged,
  subscribeNovelDataChanged,
  type NovelDataChangedDetail,
} from './storeEvents';

// node 环境无 window/CustomEvent，提供最小 shim 以验证事件总线契约
class CustomEventShim<T> extends Event {
  detail: T;
  constructor(type: string, init?: { detail?: T }) {
    super(type);
    this.detail = (init?.detail as T) ?? (undefined as unknown as T);
  }
}
const listeners: Record<string, Array<(e: Event) => void>> = {};
const windowShim: any = {
  dispatchEvent: (e: Event) => {
    (listeners[e.type] || []).forEach((l) => l(e));
    return true;
  },
  addEventListener: (t: string, l: (e: Event) => void) => {
    (listeners[t] = listeners[t] || []).push(l);
  },
  removeEventListener: (t: string, l: (e: Event) => void) => {
    listeners[t] = (listeners[t] || []).filter((x) => x !== l);
  },
};

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
  (globalThis as any).window = windowShim;
  (globalThis as any).CustomEvent = CustomEventShim;
});

describe('storeEvents 作品数据变更总线', () => {
  it('notify 触发订阅回调并携带 detail', () => {
    const got: NovelDataChangedDetail[] = [];
    const unsub = subscribeNovelDataChanged((d) => got.push(d));
    notifyNovelDataChanged({ novelId: 'nv1', kind: 'worldTracking' });
    expect(got).toEqual([{ novelId: 'nv1', kind: 'worldTracking' }]);
    unsub();
    notifyNovelDataChanged({ novelId: 'nv2' });
    expect(got.length).toBe(1); // 已取消订阅，不再收到
  });

  it('可同时挂载多个订阅者', () => {
    let a = 0;
    let b = 0;
    const ua = subscribeNovelDataChanged(() => a++);
    const ub = subscribeNovelDataChanged(() => b++);
    notifyNovelDataChanged({ novelId: 'x' });
    expect(a).toBe(1);
    expect(b).toBe(1);
    ua();
    ub();
  });

  it('window 缺失时静默 no-op（不抛错）', () => {
    delete (globalThis as any).window;
    expect(() => notifyNovelDataChanged({ novelId: 'x' })).not.toThrow();
    expect(() => subscribeNovelDataChanged(() => {})).not.toThrow();
  });
});
