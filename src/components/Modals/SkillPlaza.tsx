/**
 * 技能广场（Skill Plaza）
 *
 * 管理项目已有的「本地技能」系统（src/utils/localSkills.ts 的 LocalSkill）：
 * 这些技能在 AI 写正文 / 审校时会被自动匹配并注入上下文，是真正影响成稿的
 * 「可复用写作能力」。此前只有程序接口、没有 UI。本面板让用户：
 *   - 浏览全部技能（内置只读 + 自建可改）
 *   - 新建 / 编辑 / 克隆 / 删除自建技能
 *   - 以 Markdown 格式导入 / 导出（与后端 skills/ 目录格式一致，可分享）
 *
 * 复用 localSkills.ts 的成熟 API：listLocalSkills / saveLocalSkill /
 * removeLocalSkill / setLocalSkillEnabled / parseSkillMarkdown / serializeSkillMarkdown。
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Plus, FileJson, Trash2, Edit2, Copy, X } from '../icons';
import { Button, Input, TextArea } from '../UI';
import { useLang, t } from '../../i18n';
import { normalizeErrorMessage } from '../../utils/ai/config';
import {
  listLocalSkills,
  saveLocalSkill,
  removeLocalSkill,
  setLocalSkillEnabled,
  parseSkillMarkdown,
  serializeSkillMarkdown,
  type LocalSkill,
  type LocalSkillScope,
} from '../../utils/localSkills';

interface Props {
  isOpen: boolean;
  novelId?: string | null;
}

const splitComma = (s: string): string[] =>
  s.split(',').map((x) => x.trim()).filter(Boolean);
const joinComma = (arr?: string[]): string => (arr || []).join(', ');

function newDraft(novelId?: string | null): LocalSkill {
  return {
    id: '',
    name: '',
    description: '',
    version: '1.0.0',
    enabled: true,
    scope: 'global',
    novelId: novelId ?? undefined,
    taskTypes: [],
    triggers: [],
    allowedTools: [],
    instructions: '',
    source: 'manual',
    updatedAt: new Date().toISOString(),
  };
}

export const SkillPlaza: React.FC<Props> = ({ isOpen, novelId }) => {
  const lang = useLang();
  const [list, setList] = useState<LocalSkill[]>([]);
  const [editing, setEditing] = useState<LocalSkill | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => setList(listLocalSkills()), []);

  useEffect(() => {
    if (isOpen) {
      refresh();
      setEditing(null);
      setError(null);
    }
  }, [isOpen, refresh]);

  const handleToggle = (skill: LocalSkill) => {
    setLocalSkillEnabled(skill.id, !skill.enabled);
    refresh();
  };

  const handleClone = (skill: LocalSkill) => {
    setEditing({ ...skill, id: '', source: 'manual', enabled: true, novelId: skill.scope === 'novel' ? novelId ?? undefined : undefined });
    setError(null);
  };

  const handleDelete = (skill: LocalSkill) => {
    if (!removeLocalSkill(skill.id)) {
      setError(t('内置技能不可删除', lang));
      return;
    }
    refresh();
  };

  const handleExport = async (skill: LocalSkill) => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await save({
        filters: [{ name: '技能(Markdown)', extensions: ['md', 'txt'] }],
        defaultPath: `${skill.name}.md`,
      });
      if (!path) return;
      await writeTextFile(path as string, serializeSkillMarkdown(skill));
    } catch (e) {
      setError(normalizeErrorMessage(e) || t('导出失败', lang));
    }
  };

  const handleImport = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const selected = await open({ filters: [{ name: '技能(Markdown)', extensions: ['md', 'txt', 'json'] }] });
      if (!selected || Array.isArray(selected)) return;
      const text = await readTextFile(selected as string);
      const parsed = parseSkillMarkdown(text, { novelId: novelId ?? undefined });
      if (!parsed) {
        setError(t('无法解析：文件需为 --- 元数据 --- 指令 的 Markdown 技能格式', lang));
        return;
      }
      const saved = saveLocalSkill({ ...parsed, source: 'manual' });
      if (!saved) {
        setError(t('保存失败：名称/描述/指令不能为空，且不能与原内置技能重名', lang));
        return;
      }
      refresh();
    } catch (e) {
      setError(normalizeErrorMessage(e) || t('导入失败', lang));
    }
  };

  const handleSave = (draft: LocalSkill) => {
    const payload: Partial<LocalSkill> = {
      id: draft.id,
      name: draft.name.trim(),
      description: draft.description.trim(),
      version: draft.version.trim() || '1.0.0',
      enabled: draft.enabled,
      scope: draft.scope,
      novelId: draft.scope === 'novel' ? novelId ?? undefined : undefined,
      taskTypes: splitComma(draft.taskTypes.join(',')),
      triggers: splitComma(draft.triggers.join(',')),
      allowedTools: splitComma(draft.allowedTools.join(',')),
      instructions: draft.instructions,
      source: 'manual',
    };
    const saved = saveLocalSkill(payload);
    if (!saved) {
      setError(t('保存失败：名称/描述/指令不能为空，且不能与原内置技能重名', lang));
      return;
    }
    setEditing(null);
    setError(null);
    refresh();
  };

  // ── 编辑 / 新建表单 ──
  if (editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">
            {editing.id ? t('编辑技能', lang) : t('新建技能', lang)}
          </span>
          <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
            <X className="w-3.5 h-3.5 mr-1 inline-block" />
            {t('返回', lang)}
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-content-secondary">
            {t('名称(name)', lang)}
            <Input className="mt-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="my-style" />
          </label>
          <label className="text-xs text-content-secondary">
            {t('版本', lang)}
            <Input className="mt-1" value={editing.version} onChange={(e) => setEditing({ ...editing, version: e.target.value })} />
          </label>
        </div>

        <label className="block text-xs text-content-secondary">
          {t('描述(description)', lang)}
          <Input className="mt-1" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder={t('一句话说明这个技能做什么', lang)} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-content-secondary">
            {t('作用域(scope)', lang)}
            <select
              className="mt-1 w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-sm text-content"
              value={editing.scope}
              onChange={(e) => setEditing({ ...editing, scope: e.target.value as LocalSkillScope })}
            >
              <option value="global">global（全局）</option>
              <option value="novel">novel（当前作品）</option>
            </select>
          </label>
          <label className="text-xs text-content-secondary">
            {t('任务类型(task_types, 逗号分隔)', lang)}
            <Input className="mt-1" value={joinComma(editing.taskTypes)} onChange={(e) => setEditing({ ...editing, taskTypes: splitComma(e.target.value) })} placeholder="chapter_writing, general" />
          </label>
        </div>

        <label className="block text-xs text-content-secondary">
          {t('触发词(triggers, 逗号分隔)', lang)}
          <Input className="mt-1" value={joinComma(editing.triggers)} onChange={(e) => setEditing({ ...editing, triggers: splitComma(e.target.value) })} placeholder={t('如：续写, 润色, 文风', lang)} />
        </label>

        <label className="block text-xs text-content-secondary">
          {t('允许工具(allowed_tools, 可选, 逗号分隔)', lang)}
          <Input className="mt-1" value={joinComma(editing.allowedTools)} onChange={(e) => setEditing({ ...editing, allowedTools: splitComma(e.target.value) })} placeholder="write_chapter, continue_writing" />
        </label>

        <label className="block text-xs text-content-secondary">
          {t('指令(instructions)', lang)}
          <TextArea className="mt-1 font-mono text-xs" rows={10} value={editing.instructions} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} placeholder={t('写给 AI 的完整写作指令……', lang)} />
        </label>

        {error && (
          <div className="px-2 py-1 rounded border border-danger/30 bg-danger/10 text-xs text-danger">{error}</div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button disabled={!editing.name.trim() || !editing.description.trim() || !editing.instructions.trim()} onClick={() => handleSave(editing)}>
            {t('保存', lang)}
          </Button>
        </div>
      </div>
    );
  }

  // ── 浏览 / 广场 ──
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 flex-wrap pb-3 border-b border-line">
        <Button variant="outline" size="sm" onClick={() => { setEditing(newDraft(novelId)); setError(null); }}>
          <Plus className="w-3.5 h-3.5 mr-1 inline-block" />
          {t('新建技能', lang)}
        </Button>
        <Button variant="outline" size="sm" onClick={handleImport}>
          <FileJson className="w-3.5 h-3.5 mr-1 inline-block" />
          {t('导入 Markdown', lang)}
        </Button>
        <span className="text-xs text-content-muted ml-1">
          {t('共', lang)} {list.length} {t('个技能 · 内置', lang)} {list.filter((s) => s.source === 'builtin').length} {t('个 · 影响 AI 生成', lang)}
        </span>
      </div>

      {error && (
        <div className="mt-2 px-2 py-1 rounded border border-danger/30 bg-danger/10 text-xs text-danger">{error}</div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-show py-3 space-y-2">
        {list.map((s) => (
          <div key={s.id} className="rounded-lg border border-line bg-surface p-3">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => handleToggle(s)}
                className={`mt-0.5 w-9 h-5 rounded-full flex items-center px-0.5 transition-colors ${
                  s.enabled ? 'bg-primary' : 'bg-line-strong'
                }`}
                title={t('启用 / 停用（影响生成时是否注入）', lang)}
              >
                <span className={`w-4 h-4 rounded-full bg-white transition-transform ${s.enabled ? 'translate-x-4' : ''}`} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold font-mono">{s.name}</span>
                  <span className="px-1.5 py-0.5 rounded bg-primary-subtle text-[10px] text-content-secondary">{s.scope}</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] text-content-muted">{s.source}</span>
                  <span className="text-[10px] text-content-muted">v{s.version}</span>
                </div>
                <p className="text-xs text-content-muted mt-0.5 leading-snug">{s.description}</p>
                {(s.taskTypes.length > 0 || s.triggers.length > 0) && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {s.taskTypes.map((tt) => (
                      <span key={`t-${tt}`} className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] text-content-secondary">{tt}</span>
                    ))}
                    {s.triggers.map((tg) => (
                      <span key={`g-${tg}`} className="px-1.5 py-0.5 rounded bg-surface text-[10px] text-content-muted">{tg}</span>
                    ))}
                  </div>
                )}
                {s.instructions && (
                  <pre className="mt-2 text-[11px] text-content-secondary whitespace-pre-wrap max-h-28 overflow-hidden bg-surface-2 rounded p-2 leading-relaxed">
                    {s.instructions.length > 400 ? s.instructions.slice(0, 400) + ' …' : s.instructions}
                  </pre>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-line">
              {s.source === 'builtin' ? (
                <Button variant="outline" size="sm" onClick={() => handleClone(s)}>
                  <Copy className="w-3.5 h-3.5 mr-1 inline-block" />
                  {t('克隆改', lang)}
                </Button>
              ) : (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(s)}>
                    <Edit2 className="w-3.5 h-3.5 mr-1 inline-block" />
                    {t('编辑', lang)}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleDelete(s)}>
                    <Trash2 className="w-3.5 h-3.5 mr-1 inline-block" />
                    {t('删除', lang)}
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={() => handleExport(s)}>
                <FileJson className="w-3.5 h-3.5 mr-1 inline-block" />
                {t('导出', lang)}
              </Button>
            </div>
          </div>
        ))}
        {list.length === 0 && (
          <p className="text-sm text-content-muted text-center py-8">{t('暂无技能', lang)}</p>
        )}
      </div>
    </div>
  );
};

export default SkillPlaza;
