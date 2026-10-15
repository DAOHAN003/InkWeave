/**
 * 万象设定集页签群（V8.9.0 巨石治理第九刀，自 WorldBuilderPanel 出舱）
 *
 * wxTab 十页签（概览/体检/百科/心智/势力/人物/事件流/战争/经济/可视化）的只读渲染。
 * 代码逐字搬迁，行为零变化；页签切换与百科聚焦的联动（切走清聚焦、跳百科带聚焦）
 * 通过回调上交父组件，本组件保持纯展示。
 */

import React from 'react';
import { Tabs } from '../UI';
import { WorldEncyclopediaView } from './WorldEncyclopediaView';
import { WorldVizPanel } from '../WorldViz/WorldVizPanel';
import { CharacterMindView } from './CharacterMindView';
import type { useWanxiangWorld } from './useWanxiangWorld';

type WanxiangApi = ReturnType<typeof useWanxiangWorld>;

/** 把任意值格式化为设定集面板可读文本（对象/数组截断为 JSON） */
function fmt(v: unknown): string {
  if (v == null) return '—';
  return typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v);
}

export const WanxiangTabPanels: React.FC<{
  wxTab: string;
  onTabChange: (v: string) => void;
  wxWorldId: WanxiangApi['wxWorldId'];
  /** 渲染条件 wxExport 已由父组件保证非空 */
  wxExport: NonNullable<WanxiangApi['wxExport']>;
  wxReport: WanxiangApi['wxReport'];
  wxInfo: WanxiangApi['wxInfo'];
  wxEconomy: WanxiangApi['wxEconomy'];
  wikiFocusName: WanxiangApi['wikiFocusName'];
  onGotoEncyclopedia: (name: string) => void;
  onFocusClear: () => void;
}> = ({ wxTab, onTabChange, wxWorldId, wxExport, wxReport, wxInfo, wxEconomy, wikiFocusName, onGotoEncyclopedia, onFocusClear }) => {
  return (
    <div className="mt-3 space-y-2">
      <Tabs
        variant="pill"
        value={wxTab}
        onChange={onTabChange}
        items={[
          ['overview', '概览'],
          ['health', '世界体检'],
          ['encyclopedia', '百科'],
          ['mind', '角色心智'],
          ['factions', '势力'],
          ['characters', '人物'],
          ['events', '事件流'],
          ['wars', '战争'],
          ['economy', '经济'],
          ['viz', '可视化'],
        ].map(([k, label]) => ({ value: k, label }))}
      />

      <div className="text-xs p-2 rounded bg-surface border border-line max-h-[560px] overflow-auto">
        {wxTab === 'viz' && (
          <WorldVizPanel
            worldId={wxWorldId}
            onGotoEncyclopedia={onGotoEncyclopedia}
          />
        )}
        {wxTab === 'mind' && (
          <CharacterMindView worldId={wxWorldId} />
        )}
        {wxTab === 'encyclopedia' && (
          <WorldEncyclopediaView
            events={wxExport.events ?? []}
            entities={wxExport.entities ?? []}
            factions={wxExport.factions ?? []}
            focusEntityName={wikiFocusName}
            onFocused={onFocusClear}
          />
        )}
        {wxTab === 'overview' && wxReport && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {([
                ['种子', wxReport.seed],
                ['世界类型', wxReport.world_type],
                ['tick', wxReport.tick],
                ['天数', wxReport.day],
                ['总事件', wxReport.total_events],
                ['重大事件', wxReport.major_events],
              ] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between border-b border-line py-0.5">
                  <span className="text-content-secondary">{k}</span>
                  <span>{String(v)}</span>
                </div>
              ))}
            </div>
            <div>
              <div className="font-medium mb-1">阵营排名</div>
              <div className="space-y-1">
                {(wxReport.faction_rankings ?? []).map((r: any, i: number) => (
                  <div key={i} className="rounded bg-surface-2 px-2 py-1">
                    {Object.entries(r).map(([k, v]) => (
                      <span key={k} className="mr-3">
                        <span className="text-content-secondary">{k}:</span> {fmt(v)}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="font-medium mb-1">议题热点</div>
              <div className="space-y-1">
                {(wxReport.hotspots ?? []).map((h: any, i: number) => (
                  <div key={i} className="rounded bg-surface-2 px-2 py-1">
                    {Object.entries(h).map(([k, v]) => (
                      <span key={k} className="mr-3">
                        <span className="text-content-secondary">{k}:</span> {fmt(v)}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {wxTab === 'health' && (
          (() => {
            let info: Record<string, unknown> | null = null;
            try { info = wxInfo ? JSON.parse(wxInfo) : null; } catch { info = null; }
            const drift = info ? Number(info.conservation_drift ?? NaN) : NaN;
            const conserved = info ? Boolean(info.conserved) : null;
            const chaos = info && typeof info.chaos_edge === 'object' && info.chaos_edge !== null
              ? info.chaos_edge as Record<string, unknown>
              : null;
            const evo = wxReport?.evolution;
            return (
              <div className="space-y-3">
                {/* 守恒体检：万象确定性护城河的核心指标 */}
                <div>
                  <div className="font-medium mb-1">守恒律体检</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <div className="flex justify-between border-b border-line py-0.5">
                      <span className="text-content-secondary">守恒偏差 drift</span>
                      <span className={Number.isFinite(drift) && Math.abs(drift) > 1e-4 ? 'text-warning font-medium' : 'text-success font-medium'}>
                        {Number.isFinite(drift) ? drift.toExponential(3) : '—'}
                      </span>
                    </div>
                    <div className="flex justify-between border-b border-line py-0.5">
                      <span className="text-content-secondary">守恒判定 (ε=1e-4)</span>
                      <span className={conserved === null ? '' : conserved ? 'text-success font-medium' : 'text-danger font-medium'}>
                        {conserved === null ? '—' : conserved ? '✓ 守恒' : '✗ 漂移'}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-content-muted mt-1">
                    守恒律 drift ≈ 0 是万象确定性的基石：物质 / 能量 / 信息 / 熵经 ConservationLedger 路由，任何泄漏都会在这里暴露。
                  </p>
                </div>

                {/* 混沌边缘报告：秩序 ↔ 混沌的平衡态 */}
                {chaos && (
                  <div>
                    <div className="font-medium mb-1">混沌边缘</div>
                    <div className="space-y-1">
                      {Object.entries(chaos).map(([k, v]) => (
                        <div key={k} className="flex justify-between border-b border-line py-0.5">
                          <span className="text-content-secondary">{k}</span>
                          <span>{typeof v === 'number' ? v.toFixed(3) : String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 演化引擎统计：统一演化引擎周期运转 */}
                {evo && Object.keys(evo).length > 0 && (
                  <div>
                    <div className="font-medium mb-1">演化引擎（UnifiedEvolutionEngine）</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {Object.entries(evo).map(([k, v]) => (
                        <div key={k} className="flex justify-between border-b border-line py-0.5">
                          <span className="text-content-secondary">{k}</span>
                          <span>{String(v)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!info && !evo && (
                  <p className="text-content-muted text-[11px]">暂无体检数据——先「跑世界」生成。</p>
                )}
              </div>
            );
          })()
        )}

        {wxTab === 'factions' && (
          <table className="w-full">
            <thead>
              <tr className="text-content-secondary text-left">
                <th className="p-1">势力</th><th className="p-1">领袖</th>
                <th className="p-1 text-right">成员</th><th className="p-1 text-right">领地</th>
                <th className="p-1 text-right">资源种</th><th className="p-1 text-right">外交</th>
              </tr>
            </thead>
            <tbody>
              {(wxExport.factions ?? []).map((f: any) => (
                <tr key={f.id} className="border-t border-line">
                  <td className="p-1 font-medium">{f.name}</td>
                  <td className="p-1">{f.leader_name ?? '—'}</td>
                  <td className="p-1 text-right">{f.member_count}</td>
                  <td className="p-1 text-right">{f.territory_count}</td>
                  <td className="p-1 text-right">{f.resources?.length ?? 0}</td>
                  <td className="p-1 text-right">{f.diplomacy_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {wxTab === 'characters' && (
          <table className="w-full">
            <thead>
              <tr className="text-content-secondary text-left">
                <th className="p-1">人物</th><th className="p-1">阵营</th>
                <th className="p-1 text-right">境界</th><th className="p-1">五行</th>
                <th className="p-1 text-right">功法</th><th className="p-1 text-right">关系</th>
                <th className="p-1 text-center">存活</th>
              </tr>
            </thead>
            <tbody>
              {(wxExport.entities ?? []).map((c: any) => (
                <tr key={c.id} className="border-t border-line">
                  <td className="p-1 font-medium">{c.name}</td>
                  <td className="p-1">{c.faction_name ?? '—'}</td>
                  <td className="p-1 text-right">{c.power_rank}</td>
                  <td className="p-1">{c.wuxing_element ?? '—'}</td>
                  <td className="p-1 text-right">{c.techniques?.length ?? 0}</td>
                  <td className="p-1 text-right">{c.relationship_count}</td>
                  <td className="p-1 text-center">{c.alive ? '✓' : '✕'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {wxTab === 'events' && (
          (() => {
            const evs = [...(wxExport.events ?? [])].reverse(); // 最新在前
            if (evs.length === 0) {
              return <p className="text-content-muted text-[11px]">暂无事件。</p>;
            }
            // 事件类型 → 标签色
            const typeColor = (t: string): string => {
              const s = String(t ?? '').toLowerCase();
              if (s.includes('war') || s.includes('战争') || s.includes('battle') || s.includes('冲突')) return 'bg-danger/15 text-danger';
              if (s.includes('trade') || s.includes('经济') || s.includes('trade') || s.includes('市场')) return 'bg-success/15 text-success';
              if (s.includes('tech') || s.includes('技术') || s.includes('发明') || s.includes('研究')) return 'bg-info/15 text-info';
              if (s.includes('dipl') || s.includes('外交') || s.includes('盟') || s.includes('和')) return 'bg-primary/15 text-primary';
              if (s.includes('death') || s.includes('死') || s.includes('陨落')) return 'bg-danger/20 text-danger';
              return 'bg-surface-2 text-content-secondary';
            };
            const importanceBadge = (imp: unknown): React.ReactNode => {
              const n = Number(imp ?? 0);
              if (n >= 8) return <span className="text-[9px] px-1 rounded-full bg-danger/20 text-danger font-bold">重大</span>;
              if (n >= 5) return <span className="text-[9px] px-1 rounded-full bg-warning/20 text-warning">重要</span>;
              return null;
            };
            return (
              <div className="space-y-0">
                {evs.map((e: any, idx: number) => {
                  const isMajor = Number(e.importance ?? 0) >= 8;
                  return (
                    <div key={e.id ?? idx} className="relative flex gap-2 pb-2 pl-4">
                      {/* 时间轴竖线 + 节点 */}
                      <div className="absolute left-1 top-1 bottom-0 w-px bg-line" />
                      <span
                        className={`absolute left-0 top-1.5 w-2 h-2 rounded-full border-2 ${
                          isMajor
                            ? 'bg-danger border-danger'
                            : Number(e.importance ?? 0) >= 5
                              ? 'bg-warning border-warning'
                              : 'bg-primary border-primary/60'
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] text-content-muted tabular-nums font-mono">
                            t{e.tick}
                          </span>
                          <span className={`text-[10px] px-1 rounded ${typeColor(e.event_type)}`}>
                            {String(e.event_type ?? '')}
                          </span>
                          {importanceBadge(e.importance)}
                        </div>
                        <div className={`text-[11px] mt-0.5 leading-relaxed ${isMajor ? 'text-content font-medium' : 'text-content-secondary'}`}>
                          {String(e.description ?? '')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()
        )}

        {wxTab === 'wars' && (
          <table className="w-full">
            <thead>
              <tr className="text-content-secondary text-left">
                <th className="p-1">攻方</th><th className="p-1">守方</th>
                <th className="p-1">起因</th><th className="p-1 text-right">起始</th>
                <th className="p-1 text-right">强度</th><th className="p-1 text-center">解决</th>
                <th className="p-1 text-right">伤亡</th>
              </tr>
            </thead>
            <tbody>
              {(wxExport.wars ?? []).map((w: any) => (
                <tr key={w.id} className="border-t border-line">
                  <td className="p-1 font-medium">{w.attacker_name ?? w.attacker}</td>
                  <td className="p-1 font-medium">{w.defender_name ?? w.defender}</td>
                  <td className="p-1">{w.cause}</td>
                  <td className="p-1 text-right">{w.started_tick}</td>
                  <td className="p-1 text-right">{typeof w.intensity === 'number' ? w.intensity.toFixed(2) : w.intensity}</td>
                  <td className="p-1 text-center">{w.resolved ? '✓' : '✕'}</td>
                  <td className="p-1 text-right">{typeof w.casualties === 'number' ? w.casualties.toFixed(1) : w.casualties}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {wxTab === 'economy' && wxEconomy && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {Object.entries(wxEconomy).map(([k, v]) => (
              <div key={k} className="flex justify-between border-b border-line py-0.5">
                <span className="text-content-secondary">{k}</span>
                <span>{typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : fmt(v)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
