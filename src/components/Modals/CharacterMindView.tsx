import React, { useEffect, useState } from 'react';
import { useLang, t } from '../../i18n';
import { wxWanxiangCharacterMind, wxWanxiangCharacterNames } from '../../engines/wanxiang/wanxiangSdk';
import { Select } from '../UI';

interface MindData {
  name: string;
  gender?: string;
  age?: number;
  power_rank?: number;
  alive?: boolean;
  faction_role?: string | null;
  emotion?: Record<string, number>;
  personality?: Record<string, number>;
  goals?: Array<{ description?: string; priority?: string; progress?: number; deadline_day?: number }>;
  relationships?: Record<string, { relation_type?: string; affinity?: number; trust?: number; history?: string[] }>;
}

const EMOTION_LABELS: Array<[string, string]> = [
  ['pleasure', '愉悦'], ['arousal', '唤醒'], ['dominance', '支配'],
  ['courage', '勇气'], ['fear', '恐惧'], ['stress', '压力'],
];
const PERSONALITY_LABELS: Array<[string, string]> = [
  ['openness', '开放性'], ['conscientiousness', '尽责性'], ['extraversion', '外向性'],
  ['agreeableness', '宜人性'], ['neuroticism', '神经质'],
];

/** 数值条（0~1） */
function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, Math.abs(value) * 100));
  const color = value >= 0.7 ? 'rgb(var(--info))' : value >= 0.4 ? '#64748b' : 'rgb(var(--danger))';
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-12 flex-shrink-0 text-content-secondary">{label}</span>
      <div className="flex-1 h-1.5 rounded bg-surface">
        <div className="h-1.5 rounded" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-8 text-right text-content-muted">{value.toFixed(2)}</span>
    </div>
  );
}

/**
 * 方向5：角色心智一致性——展示角色真实心智快照（情绪/性格/目标/关系）。
 * 引擎只读查询（character_mind），零写入，确定性不受影响。
 */
export const CharacterMindView: React.FC<{ worldId: number | null }> = ({ worldId }) => {
  const lang = useLang();
  const [names, setNames] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [mind, setMind] = useState<MindData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (worldId === null) return;
    wxWanxiangCharacterNames(worldId)
      .then(setNames)
      .catch(() => setNames([]));
  }, [worldId]);

  useEffect(() => {
    if (worldId === null || !selected) {
      setMind(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    wxWanxiangCharacterMind(worldId, selected)
      .then((raw) => {
        if (cancelled) return;
        if (!raw) {
          setMind(null);
          setError(t('未找到该角色心智', lang));
          return;
        }
        setMind(JSON.parse(raw));
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [worldId, selected]);

  if (worldId === null) {
    return <div className="text-xs text-content-muted p-1">{t('先跑世界后可查看角色心智', lang)}</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-content-muted flex-shrink-0">{t('角色', lang)}</span>
        <Select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          options={names.map((n) => ({ value: n, label: n }))}
          className="w-40"
        />
        {loading && <span className="text-[10px] text-content-muted">{t('读取心智…', lang)}</span>}
      </div>
      {error && <div className="text-[10px] text-danger">{error}</div>}
      {mind && (
        <div className="space-y-2">
          <div className="text-xs font-medium">
            {mind.name}
            <span className="text-[10px] text-content-muted ml-2">
              {mind.gender} · {t('年龄', lang)} {mind.age?.toFixed(0)} · {t('实力', lang)} {mind.power_rank}
              {mind.alive === false ? ` · ${t('已亡', lang)}` : ''}
              {mind.faction_role ? ` · ${mind.faction_role}` : ''}
            </span>
          </div>
          <div className="p-2 rounded border border-line bg-surface-2">
            <div className="text-[10px] text-content-muted mb-1">{t('情绪（PAD + 应激）', lang)}</div>
            <div className="space-y-1">
              {EMOTION_LABELS.map(([k, label]) => (
                <Bar key={k} label={label} value={mind.emotion?.[k] ?? 0.5} />
              ))}
            </div>
          </div>
          <div className="p-2 rounded border border-line bg-surface-2">
            <div className="text-[10px] text-content-muted mb-1">{t('性格（Big Five）', lang)}</div>
            <div className="space-y-1">
              {PERSONALITY_LABELS.map(([k, label]) => (
                <Bar key={k} label={label} value={mind.personality?.[k] ?? 0.5} />
              ))}
            </div>
          </div>
          {mind.goals && mind.goals.length > 0 && (
            <div className="p-2 rounded border border-line bg-surface-2">
              <div className="text-[10px] text-content-muted mb-1">{t('目标', lang)}</div>
              <ul className="space-y-0.5">
                {mind.goals.map((g, i) => (
                  <li key={i} className="text-[10px] text-content-secondary">
                    {g.description}{g.priority ? `（${g.priority}）` : ''}{g.progress ? ` · ${(g.progress * 100).toFixed(0)}%` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {mind.relationships && Object.keys(mind.relationships).length > 0 && (
            <div className="p-2 rounded border border-line bg-surface-2">
              <div className="text-[10px] text-content-muted mb-1">{t('对他人的看法（心智理论）', lang)}</div>
              <ul className="space-y-1">
                {Object.entries(mind.relationships).map(([target, r]) => (
                  <li key={target} className="text-[10px] text-content-secondary">
                    {target} · {r.relation_type ?? ''} · {t('好感', lang)} {r.affinity?.toFixed(2)} / {t('信任', lang)} {r.trust?.toFixed(2)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
