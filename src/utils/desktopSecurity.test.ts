import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const tauriConfig = JSON.parse(
  readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'),
) as {
  identifier: string;
  app: { security: { csp: string | null } };
};
const capabilities = JSON.parse(
  readFileSync(resolve(root, 'src-tauri/capabilities/default.json'), 'utf8'),
) as { windows: string[]; permissions: string[] };

describe('Tauri 桌面安全配置（v2：identifier 顶层 + capabilities 权限模型）', () => {
  it('保持历史 bundle identifier，避免升级后切换应用数据目录', () => {
    expect(tauriConfig.identifier).toBe('com.novel.writer');
  });

  it('capabilities 仅开放实际使用的能力，不做全量放行', () => {
    // 权限清单必须显式枚举（v2 无 all:true 总开关，但也要防权限无限扩张）
    expect(capabilities.windows).toEqual(['main']);
    const knownPrefixes = ['core:', 'dialog:', 'fs:', 'shell:'];
    for (const p of capabilities.permissions) {
      expect(knownPrefixes.some((pre) => p.startsWith(pre))).toBe(true);
    }
    // 精确等于契约清单：core 默认 + 三个插件的最小集；新增权限须改这里并过审
    expect(capabilities.permissions).toEqual([
      'core:default',
      'dialog:allow-open',
      'dialog:allow-save',
      'dialog:allow-confirm',
      'dialog:allow-ask',
      'dialog:allow-message',
      'fs:allow-read-text-file',
      'fs:allow-read-file',
      'fs:allow-write-text-file',
      'fs:allow-write-file',
      'fs:allow-mkdir',
      'fs:allow-remove',
      'fs:scope-appcache-recursive',
      'fs:scope-appdata-recursive',
      'fs:scope-document-recursive',
      'fs:scope-download-recursive',
      'shell:allow-open',
    ]);
  });

  it('CSP 禁止任意脚本、对象和 frame 注入', () => {
    const csp = tauriConfig.app.security.csp;
    expect(csp).toBeTypeOf('string');
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
  });
});
