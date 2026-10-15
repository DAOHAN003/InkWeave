import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { STORAGE_KEYS } from './storageKeys';
import {
  getSecret,
  initializeSecureSecrets,
  resetSecureSecretsForTests,
  roleSecretId,
  SECRET_IDS,
  setSecret,
} from './credentialVault';

describe('系统凭据迁移与内存缓存', () => {
  let store: Record<string, string>;
  let native: Record<string, string>;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    store = {};
    native = {};
    resetSecureSecretsForTests();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string, args: { name: string; value?: string }) => {
      if (command === 'wx_secret_get') return native[args.name] ?? null;
      if (command === 'wx_secret_set') {
        native[args.name] = args.value ?? '';
        return undefined;
      }
      if (command === 'wx_secret_delete') {
        delete native[args.name];
        return undefined;
      }
      throw new Error(`unexpected command: ${command}`);
    });
    vi.stubGlobal('window', { __TAURI_IPC__: () => undefined });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
    });
  });

  it('成功迁移全局、嵌入与角色密钥后删除 localStorage 明文', async () => {
    store[STORAGE_KEYS.AI_KEY] = 'global-secret';
    store[STORAGE_KEYS.EMBED_API_KEY] = 'embed-secret';
    store[STORAGE_KEYS.AI_ROLE_MODELS] = JSON.stringify([
      { roleId: 'drafter', enabled: true, apiKey: 'role-secret', model: 'local' },
    ]);

    const result = await initializeSecureSecrets();

    expect(result.backend).toBe('windows-credential-manager');
    expect(result.migrated).toBe(3);
    expect(getSecret(SECRET_IDS.AI)).toBe('global-secret');
    expect(getSecret(SECRET_IDS.EMBEDDING)).toBe('embed-secret');
    expect(getSecret(roleSecretId('drafter'))).toBe('role-secret');
    expect(store[STORAGE_KEYS.AI_KEY]).toBeUndefined();
    expect(store[STORAGE_KEYS.EMBED_API_KEY]).toBeUndefined();
    expect(JSON.parse(store[STORAGE_KEYS.AI_ROLE_MODELS])).toEqual([
      { roleId: 'drafter', enabled: true, model: 'local' },
    ]);
  });

  it('系统凭据已有值时以系统值为准并清除残留旧明文', async () => {
    native[SECRET_IDS.AI] = 'native-secret';
    store[STORAGE_KEYS.AI_KEY] = 'stale-secret';

    await initializeSecureSecrets();

    expect(getSecret(SECRET_IDS.AI)).toBe('native-secret');
    expect(store[STORAGE_KEYS.AI_KEY]).toBeUndefined();
    expect(invokeMock).not.toHaveBeenCalledWith('wx_secret_set', expect.anything());
  });

  it('迁移写入失败时保留旧明文，防止升级丢密钥', async () => {
    store[STORAGE_KEYS.AI_KEY] = 'must-survive';
    invokeMock.mockImplementation(async (command: string, args: { name: string }) => {
      if (command === 'wx_secret_get') return null;
      if (command === 'wx_secret_set' && args.name === SECRET_IDS.AI) throw new Error('vault unavailable');
      return undefined;
    });

    const result = await initializeSecureSecrets();

    expect(result.retainedLegacy).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(store[STORAGE_KEYS.AI_KEY]).toBe('must-survive');
    expect(getSecret(SECRET_IDS.AI)).toBe('must-survive');
  });

  it('同一密钥的快速连续更新按调用顺序写入，最后值不会被旧请求覆盖', async () => {
    await initializeSecureSecrets();
    const writes: string[] = [];
    invokeMock.mockImplementation(async (command: string, args: { name: string; value?: string }) => {
      if (command === 'wx_secret_set') {
        writes.push(args.value ?? '');
        native[args.name] = args.value ?? '';
      }
      return null;
    });

    await Promise.all([
      setSecret(SECRET_IDS.AI, 'first'),
      setSecret(SECRET_IDS.AI, 'second'),
    ]);

    expect(writes).toEqual(['first', 'second']);
    expect(native[SECRET_IDS.AI]).toBe('second');
    expect(getSecret(SECRET_IDS.AI)).toBe('second');
  });
});
