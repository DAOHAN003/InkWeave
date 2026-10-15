/**
 * R4 AI 插图——引擎层（V7.1.0）
 *
 * 章节正文 → 场景要素（LLM 结构化，英文输出）→ 图像 prompt 组装。
 * seed 派生：FNV-1a(novelId | kind | chapterId | variant)——同输入同 seed，
 * 端点支持 seed 时同图可复现（确定性哲学在插图层的延伸）。
 *
 * 零回归设计：LLM 场景提炼失败 → naiveSceneFromText 朴素降级，
 * 生成链路任何一步都不因此变脆（chatStructured 同款哲学）。
 */

import type { ChatMessage } from '../../types/chat';
import { chatStructured, PIPELINE_SCHEMAS } from '../../utils/ai/structuredOutput';
import { deriveImageSeed } from '../../utils/ai/imageGen';

export interface SceneDescriptor {
    /** 最有画面感的单一场景（英文） */
    scene: string;
    /** 画面主体（人物/物件/位置关系，英文） */
    subject: string;
    /** 氛围与光线（英文） */
    mood: string;
    /** 风格短词（英文） */
    styleTags: string[];
    /** 需避开的元素（英文，逗号分隔） */
    negative: string;
}

export type IllustrationKind = 'chapter' | 'cover';

export interface ChapterIllustration {
    /** FNV-1a 派生种子（端点支持时同图可复现） */
    seed: number;
    /** appData 下相对路径 illustrations/{novelId}/{name}.png */
    file: string;
    /** 最终发送给图像模型的 prompt */
    prompt: string;
    /** LLM 提炼的场景描述（朴素降级时缺省） */
    scene?: string;
    kind: IllustrationKind;
    createdAt: string;
}

// ─── 确定性派生（纯函数）──────────────────────────────────────

export const illustrationSeed = (
    novelId: string,
    kind: IllustrationKind,
    chapterId: string,
    variant: number,
): number => deriveImageSeed('fuxiloom.illus.v1', novelId, kind, chapterId || '-', String(variant));

export const illustrationFileName = (kind: IllustrationKind, chapterId: string, seed: number): string =>
    `${kind}-${String(chapterId || 'novel').replace(/[^\w.-]+/g, '_').slice(0, 48)}-${seed.toString(36)}.png`;

// ─── 场景提炼（LLM 结构化 + 朴素降级）────────────────────────

const coerceDescriptor = (v: unknown): SceneDescriptor | null => {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const scene = typeof o.scene === 'string' ? o.scene.trim() : '';
    if (!scene) return null;
    return {
        scene: scene.slice(0, 600),
        subject: typeof o.subject === 'string' ? o.subject.slice(0, 400) : '',
        mood: typeof o.mood === 'string' ? o.mood.slice(0, 300) : '',
        styleTags: Array.isArray(o.styleTags)
            ? o.styleTags.filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, 6)
            : [],
        negative: typeof o.negative === 'string' ? o.negative.slice(0, 300) : '',
    };
};

/** 测试导出：结构收敛（coerce 语义锁定） */
export const _coerceDescriptor = coerceDescriptor;

export const buildSceneMessages = (sourceText: string, kind: IllustrationKind): ChatMessage[] => [
    {
        role: 'user',
        content: [
            '你是小说插画师的视觉化助手。根据下面的素材，提炼一幅插图的视觉要素。',
            kind === 'cover'
                ? '目标是书籍封面：主体居中、有戏剧张力、上部留出书名空间。'
                : '目标是章节插图：抓取最有画面感的一个场景瞬间，不要拼贴多个场景。',
            '所有字段用简洁英文输出（图像模型对英文 prompt 更稳定）；styleTags 是 2-6 个风格短词。',
            '素材：',
            '```',
            (sourceText || '').trim().slice(0, 4000),
            '```',
        ].join('\n'),
    },
];

export const extractSceneDescriptor = async (
    sourceText: string,
    kind: IllustrationKind,
    signal?: AbortSignal,
): Promise<{ descriptor: SceneDescriptor; degraded: boolean } | null> => {
    const text = (sourceText || '').trim();
    if (!text) return null;
    const res = await chatStructured<SceneDescriptor>({
        messages: buildSceneMessages(text, kind),
        schema: PIPELINE_SCHEMAS.illustrationScene,
        options: { signal, timeoutMs: 90000 },
        validate: coerceDescriptor,
    });
    if (res.data) return { descriptor: res.data, degraded: res.degraded };
    return null;
};

/** 朴素降级：无 LLM 时的确定性场景（正文前段压缩） */
export const naiveSceneFromText = (text: string, kind: IllustrationKind): SceneDescriptor => {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    const head = t.slice(0, 400);
    if (!head) {
        return {
            scene: kind === 'cover' ? 'a striking book cover for a chinese fantasy novel' : 'a quiet moment from a chinese fantasy novel',
            subject: '',
            mood: '',
            styleTags: [],
            negative: '',
        };
    }
    return {
        scene: `novel illustration of: ${head}`,
        subject: '',
        mood: '',
        styleTags: [],
        negative: '',
    };
};

// ─── prompt 组装（纯函数）─────────────────────────────────────

export const buildImagePrompt = (d: SceneDescriptor, kind: IllustrationKind, styleHint?: string): string => {
    const parts: string[] = [];
    const scene = d.scene.trim();
    if (scene) parts.push(scene);
    if (d.subject.trim()) parts.push(`main subject: ${d.subject.trim()}`);
    if (d.mood.trim()) parts.push(`mood and lighting: ${d.mood.trim()}`);
    if (styleHint && styleHint.trim()) parts.push(`overall style: ${styleHint.trim()}`);
    if (d.styleTags.length) parts.push(`style tags: ${d.styleTags.join(', ')}`);
    parts.push(
        kind === 'cover'
            ? 'book cover composition, dramatic focal point, clear space at top for title text'
            : 'cinematic novel illustration, single captured moment',
    );
    const negative = (d.negative || '').trim();
    if (negative) parts.push(`avoid: ${negative}`);
    return parts.join('. ').replace(/\.\.+/g, '.').slice(0, 1600);
};

/** 兜底负面提示（无 LLM 描述时） */
export const DEFAULT_NEGATIVE = 'text, watermark, signature, blurry, deformed hands, extra fingers, low quality';
