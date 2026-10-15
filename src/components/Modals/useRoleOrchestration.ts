/**
 * 多角色异构编排域逻辑（V8.9.0 巨石治理第十刀，自 ModelSettingsPanel 出舱）。
 *
 * 角色模型槽位（起草/审校/总编/裁决/文笔/大纲）的加载、逐槽更新与「一键混合流」预设。
 * 纯逻辑域 hook：UI 与既有签名零变化。
 */

import { useEffect, useState } from 'react';
import { getAIConfig, normalizeBaseUrl, getRoleModels, saveRoleModels } from '../../utils/ai/config';
import type { RoleModelSlot } from '../../utils/ai/types';

export function useRoleOrchestration(onError: (message: string) => void) {
  const [roles, setRoles] = useState<RoleModelSlot[]>([]);
  useEffect(() => {
    setRoles(getRoleModels());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRole = (idx: number, patch: Partial<RoleModelSlot>) => {
    setRoles((prev) => {
      const next = prev.map((r, i) => (i === idx ? { ...r, ...patch } : r));
      void saveRoleModels(next).catch((e) => onError(`角色模型配置保存失败：${String(e)}`));
      return next;
    });
  };

  /** 一键混合流：本地快模型起草 + 云端强模型审校/总编/文笔终审 */
  const applyHybridPreset = () => {
    const g = getAIConfig();
    const gLocal =
      g.backendKind === 'ollama' ||
      g.backendKind === 'llamacpp' ||
      g.baseUrl.includes('localhost') ||
      g.baseUrl.includes('127.0.0.1');
    const localUrl = gLocal ? normalizeBaseUrl(g.baseUrl) : 'http://127.0.0.1:8080';
    const cloudUrl = gLocal ? 'https://api.deepseek.com' : normalizeBaseUrl(g.baseUrl);
    const cloudKey = gLocal ? '' : g.apiKey;
    const cloudModel = gLocal ? 'deepseek-chat' : g.model;
    const temps: Record<string, number> = { drafter: 0.8, reviewer: 0.3, editor: 0.4, arbiter: 0.2, prose: 0.6, planner: 0.7 };
    const tps: Record<string, number> = { drafter: 0.95, reviewer: 0.8, editor: 0.85, arbiter: 0.7, prose: 0.9, planner: 0.9 };
    setRoles((prev) => {
      const next = prev.map((r) => {
        const isDraft = r.roleId === 'drafter';
        return {
          ...r,
          enabled: true,
          baseUrl: isDraft ? localUrl : cloudUrl,
          apiKey: isDraft ? g.apiKey : cloudKey,
          model: isDraft ? g.model : cloudModel,
          backendKind: (isDraft ? gLocal ? g.backendKind ?? 'llamacpp' : 'llamacpp' : gLocal ? 'cloud' : g.backendKind) as RoleModelSlot['backendKind'],
          temperature: temps[r.roleId] ?? 0.7,
          topP: tps[r.roleId] ?? 0.9,
        };
      });
      void saveRoleModels(next).catch((e) => onError(`角色模型配置保存失败：${String(e)}`));
      return next;
    });
  };

  /** 重载持久化配置到槽位（导入配置后调用） */
  const reloadRoles = () => setRoles(getRoleModels());

  return { roles, updateRole, applyHybridPreset, reloadRoles };
}
