/**
 * 更新检查（V10.1.2）：查询 GitHub 最新 Release，有新版本时返回信息供横幅展示。
 *
 * 设计约束：
 *  - 24h 节流（localStorage 记录上次检查时间），绝不打扰主流程；
 *  - 任何失败（网络 / 限流 / 解析）静默返回 null；
 *  - 纯前端实现（GitHub 公开 API，无鉴权），不引入 tauri updater 的签名密钥管理负担。
 */
import { STORAGE_KEYS } from './storageKeys';

const REPO = 'DAOHAN003/InkWeave';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  /** 最新版本号（去 v 前缀） */
  version: string;
  /** Release 页面链接 */
  url: string;
}

/** 宽松 semver 解析："v10.1.2" → [10,1,2]；非法输入返回 null */
export function parseVersion(v: string): number[] | null {
  const m = v.replace(/^v/i, '').match(/^\d+(\.\d+){0,3}/);
  if (!m) return null;
  return m[0].split('.').map((n) => parseInt(n, 10) || 0);
}

/** latest 是否比 current 新（逐段数值比较，缺段补 0）；任一非法返回 false */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

/** 24h 节流：距上次检查不足一天则跳过。localStorage 不可用时返回 false（宁可不查）。 */
export function shouldCheckNow(now: number = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(STORAGE_KEYS.UPDATE_CHECK_LAST_AT) || 0);
    return now - last > CHECK_INTERVAL_MS;
  } catch {
    return false;
  }
}

export function markChecked(now: number = Date.now()): void {
  try {
    localStorage.setItem(STORAGE_KEYS.UPDATE_CHECK_LAST_AT, String(now));
  } catch {
    /* 隐私模式忽略 */
  }
}

/** 查询最新 Release 并与当前版本比较；失败 / 相同 / 更旧一律返回 null。 */
export async function fetchLatestUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const d = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof d.tag_name === 'string' ? d.tag_name : '';
    const url = typeof d.html_url === 'string' ? d.html_url : `https://github.com/${REPO}/releases`;
    if (!tag || !isNewerVersion(tag, currentVersion)) return null;
    return { version: tag.replace(/^v/i, ''), url };
  } catch {
    return null;
  }
}
