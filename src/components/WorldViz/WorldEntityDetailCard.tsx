/**
 * WorldEntityDetailCard —— 星图实体详情卡（V8.5.0 T4）
 *
 * 选中实体后的深度信息卡（3D 星图 / 2D 版图两视图共用）：
 *  - 基本信息头：势力色点 / 存活徽标 / 势力 / 实力排名 / 所在地 / 五行 / 寿数
 *  - 大事记时间线：从 events.actors 反查该实体参与的历史事件（最近 8 条），
 *    tick 序号 + 事件类型色点（冲突红 / 其余暖灰，与张力曲线口径一致）+
 *    重要度亮度 + 参与者列表 + 事件描述（两行截断）
 *  - 百科跳转（onGotoEncyclopedia 钩子——星图→写作链路）
 *
 * V8.6.0：大事记条目可点击——onSeekTick 存在时点击某条事件，
 * 父层切到时间轴视图并定位到该 tick（详情卡↔时间轴联动）。
 *
 * V8.7.0 T4：大事记筛选——事件多于 4 条时显示双下拉（重要度阈值 /
 * 事件类型）；重要度档位与 vizLayout.IMPORTANCE_SCALE 同口径
 * （notable≥Notable / critical≥Critical）；筛选后计数「显 M/共 N」。
 *
 * V8.8.0 T4：筛选按实体记忆——重要度/类型选择存模块级 Map
 * （键 = 实体 id + name 复合，防跨世界同 id 串扰），切到别的实体
 * 再切回来时自动恢复；恢复的 type 经当前实体 typeOptions 校验，
 * 失配回退 all。
 *
 * V9.1.0 T4：筛选记忆跨会话持久化——模块级 Map 改为 localStorage
 * 读通（chronicleFilterMemo util：加载时读入、变更时全量回写、
 * 容量上限 200 按最久未更新淘汰）。重启 exe / 切世界再回来，
 * 每个实体的筛选档位仍在。
 *
 * V9.2.0：状态演进区块（对标 NovelCrafter Codex progressions）——
 * 可选 progression prop（由 WorldVizPanel 从 worldTracking 组装注入）：
 *  - 现状条：位置 / 情绪 / 实力 / 已知信息数 / 最后出场章（chip 一行）
 *  - 演进线：按章升序的状态/事件节点（章号刻度 + 时间标签 + 事件），
 *    与降序大事记互补——这里看成长史全貌
 * 无追踪数据时整个区块隐藏（零噪声）。
 *
 * 数据由 WorldVizPanel 从 wxWanxiangExport 原始导出解析注入，本组件纯展示零副作用。
 */
import { useEffect, useMemo, useState } from 'react';
import type { VizEntity, VizEvent } from './vizLayout';
import { factionColor, eventColor } from './vizTheme';
import { useLang, t } from '../../i18n';
import { X } from '../icons';
import { loadChronicleFilterMemo, saveChronicleFilterMemo } from '../../utils/chronicleFilterMemo';
import type { EntityProgressionData } from '../../engines/wanxiang/worldTracking';

const CHRONICLE_LIMIT = 8;
/** 筛选控件出现的事件量阈值（少于此数时筛选只是噪声） */
const FILTER_THRESHOLD = 4;

/** 重要度档位序（与 vizLayout.IMPORTANCE_SCALE 同口径，仅序用于阈值比较） */
const IMP_ORDER: readonly string[] = ['Trivial', 'Minor', 'Notable', 'Major', 'Critical', 'WorldShaking'];

type ImpFilter = 'all' | 'notable' | 'critical';

const impMinIndex = (f: ImpFilter): number => (f === 'notable' ? 2 : f === 'critical' ? 4 : -1);

/** V8.8.0：筛选记忆条目 */
interface ChronicleFilterMemo {
  imp: ImpFilter;
  type: string;
}

/**
 * V8.8.0 筛选记忆、V9.1.0 起经 chronicleFilterMemo 持久化到 localStorage：
 * 键 = 实体 id + ':' + name。id+name 复合键化解跨世界同 id（char_1 等）串扰；
 * type 失配另有 typeOptions 校验兑底。模块加载时读入持久化记忆（一次），
 * 此后每次变更全量回写（容量上限内）。
 */
const filterMemory: Map<string, ChronicleFilterMemo> = new Map(
  Object.entries(loadChronicleFilterMemo()).map(([k, v]) => [k, { imp: v.imp as ImpFilter, type: v.type }]),
);

export interface WorldEntityDetailCardProps {
  entity: VizEntity;
  /** 该实体参与的事件（已按 tick 降序，最多 CHRONICLE_LIMIT 条由内部再截） */
  events: VizEvent[];
  /** 势力色索引（-1 = 无势力） */
  factionColorIndex: number;
  /** 该实体 id（用于边计数等，不参与展示） */
  linksCount: number;
  onGotoEncyclopedia?: (name: string) => void;
  /** V8.6.0：点击大事记某条 → 跳转时间轴定位到该 tick（不传则条目不可点） */
  onSeekTick?: (tick: number) => void;
  /** V9.2.0：状态演进数据（现状 + 按章升序节点；不传或无数据则区块隐藏） */
  progression?: EntityProgressionData | null;
  onClose: () => void;
}

export function WorldEntityDetailCard({
  entity,
  events,
  factionColorIndex,
  linksCount,
  onGotoEncyclopedia,
  onSeekTick,
  progression,
  onClose,
}: WorldEntityDetailCardProps) {
  const lang = useLang();

  // ── V8.7.0 大事记筛选 + V8.8.0 按实体记忆 ──
  const [impFilter, setImpFilter] = useState<ImpFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  /** 事件类型选项：从该实体事件动态去重（稳定排序，确定性渲染） */
  const typeOptions = useMemo(
    () =>
      Array.from(
        new Set(events.map((e) => e.event_type).filter((x): x is string => !!x)),
      ).sort((a, b) => a.localeCompare(b)),
    [events],
  );

  // 记忆键：id+name 复合（防跨世界同 id 串扰）；切换实体时恢复该实体的历史筛选
  const name = entity.name ?? entity.id ?? '?';
  const memoKey = `${entity.id ?? '?'}:${name}`;
  useEffect(() => {
    const m = filterMemory.get(memoKey);
    setImpFilter(m?.imp ?? 'all');
    // 恢复的 type 必须在当前实体的类型枚举里（跨世界同名同 id 时类型集不同，失配回退 all）
    setTypeFilter(m && m.type !== 'all' && typeOptions.includes(m.type) ? m.type : 'all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoKey, typeOptions]);

  // 选择变化即写记忆（恢复 effect 触发的重渲染也会把恢复值写回，幂等无害）；
  // V9.1.0：同步全量回写 localStorage（跨会话持久化，容量上限内）
  useEffect(() => {
    filterMemory.set(memoKey, { imp: impFilter, type: typeFilter });
    saveChronicleFilterMemo(filterMemory);
  }, [memoKey, impFilter, typeFilter]);

  const filtered = useMemo(() => {
    let list = events;
    if (impFilter !== 'all') {
      const min = impMinIndex(impFilter);
      list = list.filter((e) => IMP_ORDER.indexOf(e.importance ?? '') >= min);
    }
    if (typeFilter !== 'all') {
      list = list.filter((e) => e.event_type === typeFilter);
    }
    return list;
  }, [events, impFilter, typeFilter]);

  const chronicle = useMemo(
    () =>
      [...filtered]
        .sort((a, b) => (b.tick ?? 0) - (a.tick ?? 0))
        .slice(0, CHRONICLE_LIMIT),
    [filtered],
  );

  const hasFilter = impFilter !== 'all' || typeFilter !== 'all';
  const showFilters = events.length > FILTER_THRESHOLD;

  return (
    <div className="rounded-lg border border-line bg-surface p-3 flex items-start gap-3">
      <div
        className="w-2.5 h-2.5 rounded-full mt-1 flex-shrink-0"
        style={{ background: factionColorIndex >= 0 ? factionColor(factionColorIndex) : '#888' }}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* 基本信息头 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-content">{name}</span>
          <span className={`text-[10px] ${entity.alive !== false ? 'text-success' : 'text-content-muted'}`}>
            {entity.alive !== false ? t('存活', lang) : t('陨落', lang)}
          </span>
          {linksCount > 0 && (
            <span className="text-[10px] text-content-muted">{t('关联 {n} 条', lang).replace('{n}', String(linksCount))}</span>
          )}
        </div>
        <div className="text-[11px] text-content-muted">
          {t('势力', lang)}：{entity.faction_name ?? '—'}
          {typeof entity.power_rank === 'number' && entity.power_rank > 0
            ? ` · ${t('实力排名', lang)}：#${entity.power_rank}`
            : ''}
          {entity.location_name ? ` · ${t('所在地', lang)}：${entity.location_name}` : ''}
          {entity.wuxing_element ? ` · ${t('五行', lang)}：${entity.wuxing_element}` : ''}
          {typeof entity.age === 'number' && entity.age > 0 ? ` · ${t('寿数', lang)}：${entity.age}` : ''}
        </div>

        {/* V9.2.0 状态演进：现状条（worldTracking 快照） */}
        {progression?.state && (
          <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
            <span className="text-[10px] text-content-muted">{t('现状', lang)}</span>
            {progression.state.location && (
              <span className="text-[10px] rounded bg-surface-2/60 border border-line/60 px-1 py-px text-content-secondary">
                {t('所在地', lang)}：{progression.state.location}
              </span>
            )}
            {progression.state.mood && (
              <span className="text-[10px] rounded bg-surface-2/60 border border-line/60 px-1 py-px text-content-secondary">
                {t('情绪', lang)}：{progression.state.mood}
              </span>
            )}
            {progression.state.powerLevel && (
              <span className="text-[10px] rounded bg-surface-2/60 border border-line/60 px-1 py-px text-content-secondary">
                {t('实力', lang)}：{progression.state.powerLevel}
              </span>
            )}
            {progression.state.knownCount > 0 && (
              <span className="text-[10px] rounded bg-surface-2/60 border border-line/60 px-1 py-px text-content-secondary">
                {t('已知 {n} 条', lang).replace('{n}', String(progression.state.knownCount))}
              </span>
            )}
            {progression.state.lastChapter > 0 && (
              <span className="text-[10px] rounded bg-surface-2/60 border border-line/60 px-1 py-px text-content-muted">
                {t('最后出场', lang)}：{t('第 {n} 章', lang).replace('{n}', String(progression.state.lastChapter))}
              </span>
            )}
          </div>
        )}

        {/* V9.2.0 状态演进线：按章升序的成长史（与降序大事记互补） */}
        {progression && progression.nodes.length > 0 && (
          <div className="pt-0.5">
            <div className="border-t border-line/70 pt-1.5">
              <span className="text-[11px] font-medium text-content-secondary">
                {t('状态演进（{n} 步）', lang).replace('{n}', String(progression.nodes.length))}
              </span>
            </div>
            <ul className="mt-1 space-y-1 max-h-36 overflow-y-auto scrollbar-show pr-1">
              {progression.nodes.map((n, i) => (
                <li key={`${n.chapterIdx}-${i}`} className="flex items-start gap-1.5 text-[11px] leading-snug">
                  <span className="text-[10px] text-primary/80 tabular-nums flex-shrink-0 mt-px">
                    {t('第 {n} 章', lang).replace('{n}', String(n.chapterIdx))}
                  </span>
                  {n.timeLabel && (
                    <span className="text-[10px] text-content-muted flex-shrink-0 mt-px">{n.timeLabel}</span>
                  )}
                  <span className="min-w-0 text-content-secondary line-clamp-2">{n.event}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 大事记时间线（V8.7.0：>4 条事件时附重要度/类型双筛选） */}
        <div className="pt-1">
          <div className="flex items-center justify-between gap-2 border-t border-line/70 pt-1.5">
            <span className="text-[11px] font-medium text-content-secondary truncate">
              {hasFilter
                ? `${t('大事记', lang)}（${t('显 {m} / 共 {n} 条', lang)
                    .replace('{m}', String(filtered.length))
                    .replace('{n}', String(events.length))}）`
                : t('大事记（近 {n} 条）', lang).replace('{n}', String(chronicle.length))}
            </span>
            {showFilters && (
              <span className="flex items-center gap-1 flex-shrink-0">
                <select
                  value={impFilter}
                  onChange={(e) => setImpFilter(e.target.value as ImpFilter)}
                  aria-label={t('重要度', lang)}
                  title={t('重要度', lang)}
                  className="h-5 px-1 rounded border border-line bg-surface text-[10px] text-content-secondary cursor-pointer hover:border-content-muted/40 transition-colors"
                >
                  <option value="all">{t('全部', lang)}</option>
                  <option value="notable">{t('重要以上', lang)}</option>
                  <option value="critical">{t('关键以上', lang)}</option>
                </select>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  aria-label={t('事件类型', lang)}
                  title={t('事件类型', lang)}
                  className="h-5 px-1 rounded border border-line bg-surface text-[10px] text-content-secondary cursor-pointer hover:border-content-muted/40 transition-colors max-w-24"
                >
                  <option value="all">{t('全部', lang)}</option>
                  {typeOptions.map((ty) => (
                    <option key={ty} value={ty}>
                      {ty}
                    </option>
                  ))}
                </select>
              </span>
            )}
          </div>
          {chronicle.length === 0 ? (
            <p className="text-[11px] text-content-muted mt-1 leading-relaxed">
              {hasFilter
                ? t('该筛选条件下没有事件——换个档位或类型试试。', lang)
                : t('该实体未参与任何事件——推演几步让历史发生。', lang)}
            </p>
          ) : (
            <ul className="mt-1 space-y-1 max-h-40 overflow-y-auto scrollbar-show pr-1">
              {chronicle.map((ev, i) => {
                const color = eventColor(ev.event_type);
                const actors = (ev.actors ?? []).filter((a) => a !== name).slice(0, 4);
                return (
                  <li
                    key={`${ev.id ?? i}-${ev.tick ?? 0}`}
                    onClick={onSeekTick ? () => onSeekTick(ev.tick ?? 0) : undefined}
                    title={onSeekTick ? `${t('点击跳转时间轴回放', lang)} · T${ev.tick ?? 0}` : undefined}
                    className={`flex items-start gap-1.5 text-[11px] leading-snug transition-colors ${
                      onSeekTick ? 'cursor-pointer hover:bg-surface-hover rounded px-1 -mx-1' : ''
                    }`}
                  >
                    <span className="text-[10px] text-content-muted tabular-nums flex-shrink-0 mt-px">
                      T{ev.tick ?? 0}
                    </span>
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0 mt-1 border border-black/20"
                      style={{
                        background: color,
                        opacity: ev.importance === 'WorldShaking' || ev.importance === 'Critical' ? 1 : 0.85,
                        boxShadow: color === '#e05252' ? '0 0 4px rgba(224,82,82,.55)' : 'none',
                      }}
                      title={ev.event_type ?? ''}
                    />
                    <span className="min-w-0 text-content-secondary">
                      {ev.description ? (
                        <span className="line-clamp-2">{ev.description}</span>
                      ) : (
                        <span className="text-content-muted">{ev.event_type ?? '—'}</span>
                      )}
                      {actors.length > 0 && (
                        <span className="text-content-muted"> · {actors.join('、')}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {onGotoEncyclopedia && (
        <button
          type="button"
          onClick={() => onGotoEncyclopedia(name)}
          className="text-[11px] text-primary hover:underline whitespace-nowrap"
        >
          {t('百科 →', lang)}
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        className="text-content-muted hover:text-content text-xs"
        aria-label={t('关闭', lang)}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export default WorldEntityDetailCard;
