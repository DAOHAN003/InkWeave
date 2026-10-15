/**
 * 最近万象世界记忆（V8.3.0 渲染直达）
 *
 * 背景：星图 2D/3D / 时间轴（WorldVizPanel）此前埋在世界构建器深处
 * （第 10 个页签「可视化」，且需先有 wxWorldId），用户主界面不可见。
 * 本模块用 localStorage 轻持久化「最近载入的世界 id」：
 *  - WorldBuilderPanel 载入 / 创建 / 绑定世界时 rememberWorld(id) 记一笔；
 *  - 顶层世界星图 Modal（WorldVizModal）据此自动发现世界，一键直达渲染。
 *
 * 设计约束：纯增强，不阻塞任何主链路——localStorage 不可用时全部静默降级。
 */
const KEY = 'fuxi.wx.recentWorlds';
const MAX = 8;

/** 读取最近世界 id 列表（新的在前；解析失败一律返回空数组） */
export function recentWorlds(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr: unknown = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** 记住一个世界（置顶去重，容量上限 MAX；非法 id 忽略） */
export function rememberWorld(id: number): void {
  if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) return;
  try {
    const next = [id, ...recentWorlds().filter((n) => n !== id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage 不可用（隐私模式等）：静默——纯增强不阻塞 */
  }
}
