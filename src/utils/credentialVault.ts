import { invoke } from '@tauri-apps/api/core';
import { STORAGE_KEYS } from './storageKeys';

export const SECRET_IDS = {
  AI: 'ai.primary',
  TRANSLATION: 'ai.translation',
  EMBEDDING: 'ai.embedding',
  IMAGE: 'ai.image',
} as const;

export type SecretId = string;

interface StoredRoleModel {
  roleId?: unknown;
  apiKey?: unknown;
  [key: string]: unknown;
}

export interface SecureSecretsInitResult {
  backend: 'windows-credential-manager' | 'browser-local-storage';
  migrated: number;
  retainedLegacy: number;
  errors: string[];
}

const secretCache = new Map<SecretId, string>();
const persistedSecretCache = new Map<SecretId, string>();
const writeChains = new Map<SecretId, Promise<void>>();
let initializePromise: Promise<SecureSecretsInitResult> | null = null;

const LEGACY_SCALAR_KEYS: ReadonlyArray<readonly [SecretId, string]> = [
  [SECRET_IDS.AI, STORAGE_KEYS.AI_KEY],
  [SECRET_IDS.TRANSLATION, STORAGE_KEYS.TRANSLATE_KEY],
  [SECRET_IDS.EMBEDDING, STORAGE_KEYS.EMBED_API_KEY],
  [SECRET_IDS.IMAGE, STORAGE_KEYS.IMAGE_API_KEY],
];

export const roleSecretId = (roleId: string): SecretId => `ai.role.${roleId}`;

/** Tauri v1 在桌面 WebView 中注入该 IPC 函数；普通 Vite/浏览器开发环境没有。 */
export const usesSecureCredentialStore = (): boolean =>
  typeof window !== 'undefined' && typeof (window as Window & { __TAURI_IPC__?: unknown }).__TAURI_IPC__ === 'function';

const readStoredRoles = (): StoredRoleModel[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.AI_ROLE_MODELS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is StoredRoleModel => !!item && typeof item === 'object') : [];
  } catch {
    return [];
  }
};

const persistStoredRoles = (roles: StoredRoleModel[]): void => {
  localStorage.setItem(STORAGE_KEYS.AI_ROLE_MODELS, JSON.stringify(roles));
};

const setCached = (name: SecretId, value: string): void => {
  if (value) secretCache.set(name, value);
  else secretCache.delete(name);
};

const setLoadedSecret = (name: SecretId, value: string): void => {
  setCached(name, value);
  if (value) persistedSecretCache.set(name, value);
  else persistedSecretCache.delete(name);
};

const readNative = (name: SecretId): Promise<string | null> =>
  invoke<string | null>('wx_secret_get', { name });

const writeNative = (name: SecretId, value: string): Promise<void> =>
  invoke<void>('wx_secret_set', { name, value });

const deleteNative = (name: SecretId): Promise<void> =>
  invoke<void>('wx_secret_delete', { name });

/**
 * 在 React 挂载前加载密钥。
 * 桌面版会把旧 localStorage 明文迁入 Windows Credential Manager；只有确认写入成功后才删旧值。
 * 普通浏览器开发模式没有系统凭据库，因此保留旧存储作为兼容回退，但业务读取仍只访问内存缓存。
 */
export function initializeSecureSecrets(): Promise<SecureSecretsInitResult> {
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    const desktop = usesSecureCredentialStore();
    const result: SecureSecretsInitResult = {
      backend: desktop ? 'windows-credential-manager' : 'browser-local-storage',
      migrated: 0,
      retainedLegacy: 0,
      errors: [],
    };

    for (const [secretId, storageKey] of LEGACY_SCALAR_KEYS) {
      const legacy = localStorage.getItem(storageKey) || '';
      if (!desktop) {
        setLoadedSecret(secretId, legacy);
        continue;
      }

      try {
        const stored = await readNative(secretId);
        if (stored !== null) {
          setLoadedSecret(secretId, stored);
          if (localStorage.getItem(storageKey) !== null) localStorage.removeItem(storageKey);
        } else if (legacy) {
          await writeNative(secretId, legacy);
          setLoadedSecret(secretId, legacy);
          localStorage.removeItem(storageKey);
          result.migrated += 1;
        }
      } catch (error) {
        // 迁移失败时保留旧明文，防止升级导致用户密钥丢失；本次会话仍从内存使用它。
        setLoadedSecret(secretId, legacy);
        if (legacy) result.retainedLegacy += 1;
        result.errors.push(`${secretId}: ${String(error)}`);
      }
    }

    const roles = readStoredRoles();
    let rolesChanged = false;
    for (const role of roles) {
      if (typeof role.roleId !== 'string' || !role.roleId) continue;
      const secretId = roleSecretId(role.roleId);
      const legacy = typeof role.apiKey === 'string' ? role.apiKey : '';
      if (!desktop) {
        setLoadedSecret(secretId, legacy);
        continue;
      }

      try {
        const stored = await readNative(secretId);
        if (stored !== null) {
          setLoadedSecret(secretId, stored);
          if ('apiKey' in role) {
            delete role.apiKey;
            rolesChanged = true;
          }
        } else if (legacy) {
          await writeNative(secretId, legacy);
          setLoadedSecret(secretId, legacy);
          delete role.apiKey;
          rolesChanged = true;
          result.migrated += 1;
        } else if ('apiKey' in role) {
          delete role.apiKey;
          rolesChanged = true;
        }
      } catch (error) {
        setLoadedSecret(secretId, legacy);
        if (legacy) result.retainedLegacy += 1;
        result.errors.push(`${secretId}: ${String(error)}`);
      }
    }
    if (desktop && rolesChanged) persistStoredRoles(roles);

    return result;
  })();

  return initializePromise;
}

/** 同步读取仅命中启动阶段填充的内存缓存，不触碰 localStorage。 */
export const getSecret = (name: SecretId): string => secretCache.get(name) || '';

function enqueueWrite(name: SecretId, operation: () => Promise<void>): Promise<void> {
  const previous = writeChains.get(name) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  writeChains.set(name, next);
  void next.finally(() => {
    if (writeChains.get(name) === next) writeChains.delete(name);
  }).catch(() => undefined);
  return next;
}

/** 更新内存密钥，并按运行环境持久化。相同密钥的快速连续写入会严格保持提交顺序。 */
export function setSecret(name: SecretId, value: string): Promise<void> {
  setCached(name, value);
  const legacyKey = LEGACY_SCALAR_KEYS.find(([id]) => id === name)?.[1];
  if (!usesSecureCredentialStore()) {
    if (legacyKey) {
      if (value) localStorage.setItem(legacyKey, value);
      else localStorage.removeItem(legacyKey);
    }
    setLoadedSecret(name, value);
    return Promise.resolve();
  }
  return enqueueWrite(name, async () => {
    try {
      if (value) await writeNative(name, value);
      else await deleteNative(name);
      setLoadedSecret(name, value);
      if (legacyKey) localStorage.removeItem(legacyKey);
    } catch (error) {
      // 仅当没有更新的写入覆盖当前值时回滚，避免旧请求失败反向覆盖新输入。
      if (getSecret(name) === value) setCached(name, persistedSecretCache.get(name) || '');
      throw error;
    }
  });
}

export function deleteSecret(name: SecretId): Promise<void> {
  return setSecret(name, '');
}

/**
 * 持久化角色密钥并返回可安全写入 localStorage 的角色配置。
 * 浏览器开发模式保留旧格式；桌面版剥离 apiKey，只留下非敏感模型参数。
 */
export async function saveRoleSecrets<T extends { roleId: string; apiKey: string }>(
  roles: T[],
): Promise<Array<Omit<T, 'apiKey'> & { apiKey?: string }>> {
  await Promise.all(roles.map((role) => {
    const secretId = roleSecretId(role.roleId);
    return getSecret(secretId) === role.apiKey
      ? Promise.resolve()
      : setSecret(secretId, role.apiKey);
  }));
  if (!usesSecureCredentialStore()) return roles;
  return roles.map(({ apiKey: _apiKey, ...role }) => role);
}

/** 测试隔离使用；生产代码不应调用。 */
export function resetSecureSecretsForTests(): void {
  secretCache.clear();
  persistedSecretCache.clear();
  writeChains.clear();
  initializePromise = null;
}
