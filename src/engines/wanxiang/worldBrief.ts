/**
 * 把万象引擎真实演化的世界数据压缩成 AI 写稿可用的「世界简报」。
 * 纯函数，无 React / Tauri 依赖，便于单测锁定格式与截断上限。
 */

export interface WorldBriefExport {
  factions?: Array<{ name: string; leader_name?: string; member_count?: number; territory_count?: number; resources?: unknown[] }>;
  entities?: Array<{ name: string; faction_name?: string; power_rank?: number; wuxing_element?: string; alive?: boolean }>;
  events?: Array<{ tick?: number; event_type?: string; importance?: string; description?: string }>;
  wars?: Array<{ attacker?: string; attacker_name?: string; defender?: string; defender_name?: string; cause?: string; intensity?: number | string; resolved?: boolean }>;
}

export interface WorldBriefReport {
  day?: number;
  tick?: number;
  world_type?: string;
}

/**
 * 把演化世界数据拼成给 AI 的上下文简报。
 * 截断上限：势力 8 / 人物 10 / 事件 12（最新在前）/ 进行中战争 5。
 * 某类数据为空时整段省略（不输出空标题）。
 */
export function buildWorldBrief(exp: WorldBriefExport | null, rep: WorldBriefReport | null, genre: string): string {
  const parts: string[] = [];
  parts.push(`世界类型：${genre}`);
  if (rep) {
    const time: string[] = [];
    if (rep.day != null) time.push(`第 ${rep.day} 天`);
    if (rep.tick != null) time.push(`tick ${rep.tick}`);
    if (time.length) parts.push(`时间：${time.join(' / ')}`);
    if (rep.world_type) parts.push(`引擎世界类型：${rep.world_type}`);
  }

  const factions = (exp?.factions ?? []).slice(0, 8);
  if (factions.length) {
    parts.push(
      '【主要势力】\n' +
        factions
          .map(
            (f) =>
              `- ${f.name}（领袖 ${f.leader_name ?? '未知'}，成员 ${f.member_count ?? '?'}，领地 ${
                f.territory_count ?? '?'
              }${f.resources?.length ? `，资源 ${f.resources.length} 种` : ''}）`,
          )
          .join('\n'),
    );
  }

  const entities = (exp?.entities ?? []).slice(0, 10);
  if (entities.length) {
    parts.push(
      '【关键人物】\n' +
        entities
          .map(
            (c) =>
              `- ${c.name}（${c.faction_name ?? '无阵营'}，境界 ${c.power_rank ?? '?'}，${c.wuxing_element ?? ''}${
                c.alive ? '，存活' : '，陨落'
              }）`,
          )
          .join('\n'),
    );
  }

  const events = (exp?.events ?? []).slice(-12).reverse();
  if (events.length) {
    parts.push(
      '【近期事件（最新在前）】\n' +
        events.map((e) => `- [t${e.tick}] ${e.description ?? ''}（${e.event_type ?? ''}/${e.importance ?? ''}）`).join('\n'),
    );
  }

  const wars = (exp?.wars ?? []).filter((w) => !w.resolved).slice(0, 5);
  if (wars.length) {
    parts.push(
      '【进行中的战争】\n' +
        wars
          .map(
            (w) =>
              `- ${w.attacker_name ?? w.attacker} vs ${w.defender_name ?? w.defender}：${w.cause ?? ''}（强度 ${
                typeof w.intensity === 'number' ? w.intensity.toFixed(2) : w.intensity
              }）`,
          )
          .join('\n'),
    );
  }

  return parts.join('\n\n');
}
