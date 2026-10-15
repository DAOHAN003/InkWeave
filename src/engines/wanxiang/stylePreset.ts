/**
 * 风格预设（Style Preset）—— V6.2.0 风格调优的可自动化部分。
 *
 * 定位：把「风格调优」从用户手写提示词/手调阈值，升级为一键预设。
 * 每个预设 = 生成期「文风指令块」（进写作 prompt）+ 检查期「阈值覆盖」
 * （经 utils/guardThresholds 应用到文风红线与一致性检查）。
 *
 * 架构纪律（与 entityGuard ↔ guardThresholds 同构）：
 *  - 本模块是纯函数（零 localStorage / 零 DOM），引擎层可安全 import；
 *  - localStorage 读写收在 utils/guardThresholds（readStylePresetId /
 *    writeStylePresetId）与 chapterGenerate 的 readStylePresetBlock
 *    （沿用 readStyleSamples 的 node 安全模式）；
 *  - 预设阈值只覆盖文本守卫 7 项（口头禅/明喻/薄章），不碰一致性
 *    结构规则——结构规则与文风无关。
 */

/** 预设可覆盖的阈值子集（与 TextGuardThresholds 对齐的键） */
export interface StylePresetThresholds {
    clicheFailSingle?: number;
    clicheFailTotal?: number;
    clicheWarnTotal?: number;
    simileWarnPer10k?: number;
    simileFailPer10k?: number;
    thinAbsFloor?: number;
    thinTargetRatio?: number;
}

export interface StylePreset {
    id: string;
    /** 展示名（中文，i18n 源语言） */
    label: string;
    /** 一句话定位（面板说明） */
    desc: string;
    /** 生成期注入的文风指令（prompt 块正文） */
    directive: string;
    /** 检查期阈值覆盖（叠加在用户存储值之上） */
    thresholds: StylePresetThresholds;
}

/** 五档内置预设（全球对标：Sudowrite 风格拨盘 / Novelcrafter 风格预设） */
export const STYLE_PRESETS: readonly StylePreset[] = [
    {
        id: 'xianxia',
        label: '仙侠古雅',
        desc: '半文半白、四字短语、诗性克制',
        directive:
            '1. 语言半文半白：多用四字短语与古雅词汇，杜绝网络流行语与现代口癖。\n' +
            '2. 诗性克制：意象点到即止，不铺陈形容词；山川器物有名有形。\n' +
            '3. 对话留古意：称谓、语气、句式贴合修仙世界，避免大白话。\n' +
            '4. 招式与法宝的描写要有动静虚实，不堆砌「轰然」「暴涨」。',
        thresholds: { simileWarnPer10k: 10, simileFailPer10k: 20 },
    },
    {
        id: 'shuangwen',
        label: '现代爽文',
        desc: '短句快节奏、强钩子、情绪爆点',
        directive:
            '1. 短句为主：三五句一段，节奏快，信息密度高。\n' +
            '2. 章末强钩子：每章结尾必须有悬念或反转，逼读者点下一章。\n' +
            '3. 情绪爆点：冲突直给，打脸干脆，不绕弯子。\n' +
            '4. 心理描写点到即止，用行动与对话推进。',
        thresholds: { simileWarnPer10k: 14, simileFailPer10k: 30, thinAbsFloor: 1200, clicheWarnTotal: 5 },
    },
    {
        id: 'xuanyi',
        label: '悬疑冷硬',
        desc: '冷色感官、短句留白、零口头禅',
        directive:
            '1. 冷硬派笔法：名词与动词驱动，少用形容词与副词。\n' +
            '2. 只给证据不解释情绪：写「他把烟按灭在杯底」，不写「他很烦躁」。\n' +
            '3. 信息控制：每段只透露一条线索，留白制造不安。\n' +
            '4. 感官用冷色：雨、金属、烟味、霓虹，拒绝暖融融的氛围词。',
        thresholds: { clicheFailTotal: 6, simileWarnPer10k: 8, simileFailPer10k: 16 },
    },
    {
        id: 'yanqing',
        label: '言情细腻',
        desc: '微表情、感官流动、绵密心理',
        directive:
            '1. 微表情与体感：指尖、呼吸、视线停留处见情绪，不直说心动。\n' +
            '2. 心理绵密但有层次：一段只走一种情绪的递进，不混叠。\n' +
            '3. 对话要有潜台词与试探感，破防时刻用动作收束。\n' +
            '4. 环境描写服务于情绪温度（光影、气候、衣料质地）。',
        thresholds: { simileWarnPer10k: 16, simileFailPer10k: 28, clicheWarnTotal: 5 },
    },
    {
        id: 'kehuan',
        label: '科幻克制',
        desc: '术语质感、精确度量、名词驱动',
        directive:
            '1. 名词动词驱动：技术细节用精确名词，不滥用比喻解释原理。\n' +
            '2. 度量感：距离、时间、参数给具体数字，营造工程质感。\n' +
            '3. 克制的惊奇：面对宏大事物，用人物的具体反应侧写，不堆感叹。\n' +
            '4. 术语自然嵌入对话，不用旁白式科普腔。',
        thresholds: { simileWarnPer10k: 6, simileFailPer10k: 14 },
    },
] as const;

/** 按 id 取预设（未知 id / 空串 → null）。 */
export function getStylePreset(id: string | null | undefined): StylePreset | null {
    if (!id) return null;
    return STYLE_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * 构建生成期文风指令块（进写作 prompt）。
 * 未选预设返回 ''（不污染 prompt）。
 */
export function buildStylePresetBlock(id: string | null | undefined): string {
    const preset = getStylePreset(id);
    if (!preset) return '';
    return `\n\n── 文风预设：${preset.label}（必须贯彻）──\n${preset.directive}`;
}

/**
 * 检查期阈值覆盖：把预设阈值叠加到 base 之上（预设优先）。
 * 只覆盖预设显式给出的键；泛型保持 base 的完整类型。
 */
export function applyStylePresetThresholds<T extends Record<string, unknown>>(base: T, id: string | null | undefined): T {
    const preset = getStylePreset(id);
    if (!preset) return base;
    return { ...base, ...preset.thresholds };
}
