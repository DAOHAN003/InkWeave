/**
 * 精简小说类型定义
 *
 * 仅保留 wanxiang/ 引擎栈（outlineTree.ts, worldTracking.ts）所需字段。
 * 切断与原项目复杂类型网络的耦合。
 */

export interface Character {
    id: string;
    name: string;
    /** 性格特征 */
    personality?: string;
    /** 角色描述 */
    description?: string;
    /** 角色身份/职业 */
    role?: string;
    /** 出场章节索引列表 */
    appearances?: number[];
    /** A2：剧情档案（L3 记忆层）——每章提取的"经历条目"，写他时注入保持长期一致性 */
    storyArc?: string[];
    /** 语气锚点（轻量角色锁 character lock）：该角色说话的基调，如"冷峻简短/温柔绵长/毒舌犀利" */
    voiceTone?: string;
    /** 口癖 / 招牌句式（轻量角色锁）：该角色习惯性使用的词句，如"……吧""罢了""俺"；多条用、，,分隔 */
    speechHabit?: string;
    /** 禁用言行（轻量角色锁）：该角色绝不会说/做的词句，如"求饶""对不起"；多条用、，,分隔；进 OOC 守门 */
    forbiddenSpeech?: string;
}

/** 势力 / 组织（用于关系网势力节点与跨章势力共现提取） */
export interface Faction {
    id: string;
    name: string;
    /** 势力描述 / 定位 */
    description?: string;
}

/** 地点（V8.5.0 情节网格地点线）：名所/秘境/城邦——名字+别名匹配全书出场 */
export interface Location {
    id: string;
    name: string;
    /** 地点描述（风貌 / 势力归属 / 意义） */
    description?: string;
    /** 别名 / 古称 / 简称（与 name 一起作为匹配词，多条用、，,分隔） */
    aliases?: string;
}

export interface Volume {
    id: string;
    title: string;
    /** 卷大纲 */
    outline: string;
    chapters: Chapter[];
    /** UI 折叠状态 */
    collapsed?: boolean;
    /** A1：卷概要（L1 记忆层）——写完一卷用 AI 压缩为 ~500 字，后续卷引用以保持长期记忆 */
    summary?: string;
}

/** 章节伏笔条目（被 outlineTree.extractForeshadowings 使用） */
export interface ForeshadowingItem {
    id: string;
    text: string;
    /** 填坑章节 id */
    resolvedChapterId?: string | null;
    /** 填坑章节标题 */
    resolvedChapterTitle?: string | null;
    /** 全书顺序编号 */
    resolvedChapterIdx?: number | null;
    /** 填坑章节里的对应伏笔 id */
    resolvedByForeshadowingId?: string | null;
    /** 是否由 AI 自动生成 */
    isAutoLinked?: boolean;
}

/** 章节总结（被 outlineTree.extractForeshadowings 使用） */
export interface ChapterSummary {
    plotDirection: string;
    foreshadowing: ForeshadowingItem[];
    characters: string[];
    updatedAt: number;
    createdAt: number;
}

/** 章节版本快照（多版本草稿）：AI 写/改写/提质/自检闭环应用前自动快照旧正文；也可手动保存 */
export interface ChapterVersion {
    id: string;
    content: string;
    wordCount: number;
    /** 快照时间（ISO） */
    createdAt: string;
    /** 来源标注：AI 生成 / 改写 / 提质润色 / 自检闭环 / 手动保存 / 回退前 */
    note?: string;
}

/** 章节插图（R4 AI 插图，V7.1.0）：确定性 seed 生成，文件存 appData illustrations/，meta 存章节 */
export interface ChapterIllustration {
    /** FNV-1a 派生种子（端点支持时同图可复现） */
    seed: number;
    /** appData 下相对路径 illustrations/{novelId}/{name}.png */
    file: string;
    /** 最终发送给图像模型的英文 prompt */
    prompt: string;
    /** LLM 提炼的场景描述（朴素降级时缺省） */
    scene?: string;
    kind: 'chapter' | 'cover';
    createdAt: string;
}

export interface Chapter {
    id: string;
    title: string;
    content: string;
    updatedAt: string;
    /** 章节大纲（L4） */
    outline: string;
    wordCount?: number;
    summary?: ChapterSummary;
    /** 多版本草稿：历史快照，最新在前；缺省=旧作品无版本（向后兼容） */
    versions?: ChapterVersion[];
    /**
     * 出海译文（按目标语言代码存，如 en/ja/es/pt）；缺省=未翻译。
     * 与正文同走外置存储（fx_chapters v2 载荷），不会撑爆 localStorage。
     */
    translations?: Record<string, string>;
    /** R4 AI 插图（V7.1.0）：章节配图，文件存 appData，此处存 meta；缺省=未生成 */
    illustration?: ChapterIllustration;
}

export interface Novel {
    id: string;
    title: string;
    /** 作者名（用于 EPUB 元数据，可选） */
    author?: string;
    /** 类型，如 'xuanhuan' | 'xianxia' | 'scifi' ... */
    type: string;
    /** 风格标签 */
    style: string;
    description: string;
    /** 主题色（CSS 颜色或预设名） */
    color: string;
    volumes: Volume[];
    characters: Character[];
    /** 势力 / 组织（关系网势力节点 + 跨章共现提取源） */
    factions?: Faction[];
    /** 地点（V8.5.0 情节网格地点线；缺省=旧作品无地点） */
    locations?: Location[];
    /** 创建时间 */
    createdAt?: string;
    /** 最后更新时间 */
    updatedAt?: string;
    /** 5 层大纲树（可选，由 outlineTree 模块管理） */
    outlineTree?: import('../engines/wanxiang/outlineTree').OutlineTree;
    /** 世界追踪数据（可选，由 worldTracking 模块管理） */
    worldTracking?: import('../engines/wanxiang/worldTracking').WorldTrackingState;
    /** R4 AI 封面（V7.1.0）：与章节插图同结构；缺省=未生成 */
    cover?: ChapterIllustration;
}
