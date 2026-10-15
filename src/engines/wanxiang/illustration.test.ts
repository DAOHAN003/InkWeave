/**
 * R4 插图引擎层测试（V7.1.0）。
 * 覆盖：
 *  1. illustrationSeed / illustrationFileName：确定性、变体敏感、文件名清洗
 *  2. buildSceneMessages：kind 语义注入
 *  3. extractSceneDescriptor：结构收敛 / degraded 透传 / 失败返回 null（降级入口）
 *  4. naiveSceneFromText：空文本兜底 / 正文压缩
 *  5. buildImagePrompt：组装顺序 / cover 构图指令 / negative 后缀 / styleHint / 长度上限
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/ai/structuredOutput', () => ({
    chatStructured: vi.fn(),
    PIPELINE_SCHEMAS: {
        illustrationScene: { name: 'illustration_scene', schema: { type: 'object' } },
    },
    extractJsonLoose: () => null,
}));
vi.mock('../../utils/ai/imageGen', () => ({
    // 可测的确定性替身：与真实实现同构的字符串敏感哈希（同输入同输出、变体敏感）
    deriveImageSeed: (...parts: Array<string | number>) =>
        parts.reduce<number>((h, p) => {
            const s = String(p);
            for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
            return (h * 31 + 0x2f) >>> 0;
        }, 7),
}));

import {
    illustrationSeed,
    illustrationFileName,
    buildSceneMessages,
    extractSceneDescriptor,
    naiveSceneFromText,
    buildImagePrompt,
    _coerceDescriptor,
    type SceneDescriptor,
} from './illustration';
import { chatStructured } from '../../utils/ai/structuredOutput';

const chatStructuredMock = vi.mocked(chatStructured);

beforeEach(() => {
    chatStructuredMock.mockReset();
});

// ─────────────────────── 1. 派生纯函数 ───────────────────────

describe('illustrationSeed / illustrationFileName', () => {
    it('确定性：同输入同 seed', () => {
        expect(illustrationSeed('n1', 'chapter', 'c1', 0)).toBe(illustrationSeed('n1', 'chapter', 'c1', 0));
    });
    it('变体 / kind / chapter 敏感', () => {
        expect(illustrationSeed('n1', 'chapter', 'c1', 0)).not.toBe(illustrationSeed('n1', 'chapter', 'c1', 1));
        expect(illustrationSeed('n1', 'chapter', 'c1', 0)).not.toBe(illustrationSeed('n1', 'cover', 'c1', 0));
        expect(illustrationSeed('n1', 'chapter', 'c1', 0)).not.toBe(illustrationSeed('n1', 'chapter', 'c2', 0));
    });
    it('文件名：非法字符清洗 + seed 36 进制', () => {
        const name = illustrationFileName('chapter', 'ch/1 中文:id', 123456);
        expect(name).toMatch(/^chapter-/);
        expect(name).not.toContain('/');
        expect(name).not.toContain(':');
        expect(name).not.toContain(' ');
        expect(name.endsWith('.png')).toBe(true);
        expect(name).toContain((123456).toString(36));
    });
    it('空 chapterId 兜底为 novel', () => {
        expect(illustrationFileName('cover', '', 1)).toMatch(/^cover-novel-/);
    });
});

// ─────────────────────── 2. 场景提炼消息 ───────────────────────

describe('buildSceneMessages', () => {
    it('chapter：单场景瞬间指令 + 素材注入', () => {
        const msgs = buildSceneMessages('林芷若立于剑冢之上。', 'chapter');
        expect(msgs).toHaveLength(1);
        expect(msgs[0].role).toBe('user');
        expect(msgs[0].content).toContain('章节插图');
        expect(msgs[0].content).toContain('林芷若立于剑冢之上。');
        expect(msgs[0].content).toContain('英文');
    });
    it('cover：封面构图指令', () => {
        const msgs = buildSceneMessages('书名：墨织', 'cover');
        expect(msgs[0].content).toContain('书籍封面');
        expect(msgs[0].content).toContain('书名空间');
    });
    it('素材超长截断到 4000 字', () => {
        const long = 'x'.repeat(5000);
        const msgs = buildSceneMessages(long, 'chapter');
        expect((msgs[0].content as string).length).toBeLessThan(4300);
    });
});

// ─────────────────────── 3. extractSceneDescriptor ───────────────────────

describe('extractSceneDescriptor', () => {
    it('成功：结构收敛 + degraded 透传', async () => {
        chatStructuredMock.mockResolvedValue({
            data: {
                scene: 'a sword mound under moonlight',
                subject: 'a tall woman in white robes',
                mood: 'cold, misty',
                styleTags: ['ink wash', 'wuxia', 'cinematic'],
                negative: 'text, watermark',
            },
            degraded: false,
            constrained: true,
            raw: '',
        } as never);
        const r = await extractSceneDescriptor('正文……', 'chapter');
        expect(r).not.toBeNull();
        expect(r!.descriptor.scene).toBe('a sword mound under moonlight');
        expect(r!.degraded).toBe(false);
        expect(chatStructuredMock).toHaveBeenCalledTimes(1);
        const arg = chatStructuredMock.mock.calls[0][0] as { schema: { name: string } };
        expect(arg.schema.name).toBe('illustration_scene');
    });

    it('LLM 失败 → null（调用方走朴素降级）', async () => {
        chatStructuredMock.mockResolvedValue({ data: null, degraded: true, constrained: false, raw: '' } as never);
        const r = await extractSceneDescriptor('正文……', 'chapter');
        expect(r).toBeNull();
    });

    it('空文本直接 null，不发起 LLM 调用', async () => {
        const r = await extractSceneDescriptor('   ', 'chapter');
        expect(r).toBeNull();
        expect(chatStructuredMock).not.toHaveBeenCalled();
    });
});

describe('_coerceDescriptor 结构收敛', () => {
    it('缺 scene → null', () => {
        expect(_coerceDescriptor({ subject: 'x' })).toBeNull();
        expect(_coerceDescriptor(null)).toBeNull();
        expect(_coerceDescriptor('str')).toBeNull();
    });
    it('字段截断 + styleTags 过滤', () => {
        const d = _coerceDescriptor({
            scene: 's'.repeat(800),
            subject: 'u'.repeat(500),
            mood: 123,
            styleTags: ['a', '', 42, 'b', 'c', 'd', 'e', 'f', 'g'],
            negative: 'n'.repeat(400),
        });
        expect(d).not.toBeNull();
        expect(d!.scene.length).toBe(600);
        expect(d!.subject.length).toBe(400);
        expect(d!.mood).toBe('');
        expect(d!.styleTags).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(d!.negative.length).toBe(300);
    });
});

// ─────────────────────── 4. 朴素降级 ───────────────────────

describe('naiveSceneFromText', () => {
    it('空文本 → 通用兜底场景', () => {
        const d = naiveSceneFromText('', 'chapter');
        expect(d.scene.length).toBeGreaterThan(10);
        expect(d.subject).toBe('');
    });
    it('正文 → 压缩前 400 字 + 前缀', () => {
        const d = naiveSceneFromText('第一段。第二段。', 'chapter');
        expect(d.scene).toContain('novel illustration of:');
        expect(d.scene).toContain('第一段');
    });
});

// ─────────────────────── 5. buildImagePrompt ───────────────────────

describe('buildImagePrompt', () => {
    const base: SceneDescriptor = {
        scene: 'A sword mound under moonlight',
        subject: 'a woman in white',
        mood: 'cold mist',
        styleTags: ['ink wash', 'wuxia'],
        negative: 'text, watermark',
    };

    it('组装顺序：scene → subject → mood → styleHint → tags → 构图 → avoid', () => {
        const p = buildImagePrompt(base, 'chapter', 'song dynasty painting');
        const idx = [
            p.indexOf('A sword mound under moonlight'),
            p.indexOf('main subject:'),
            p.indexOf('mood and lighting:'),
            p.indexOf('overall style: song dynasty painting'),
            p.indexOf('style tags: ink wash, wuxia'),
            p.indexOf('cinematic novel illustration'),
            p.indexOf('avoid: text, watermark'),
        ];
        expect(idx.every((i) => i >= 0)).toBe(true);
        expect(idx).toEqual([...idx].sort((a, b) => a - b));
    });

    it('cover 构图指令', () => {
        const p = buildImagePrompt(base, 'cover');
        expect(p).toContain('book cover composition');
        expect(p).not.toContain('cinematic novel illustration');
    });

    it('空字段跳过、无 negative 不加 avoid', () => {
        const p = buildImagePrompt({ scene: 'only scene', subject: '', mood: '', styleTags: [], negative: '' }, 'chapter');
        expect(p).toContain('only scene');
        expect(p).not.toContain('main subject');
        expect(p).not.toContain('mood and lighting');
        expect(p).not.toContain('style tags');
        expect(p).not.toContain('avoid');
    });

    it('长度上限 1600', () => {
        const p = buildImagePrompt(
            { ...base, scene: 'x'.repeat(3000), subject: 'y'.repeat(2000) },
            'chapter',
        );
        expect(p.length).toBeLessThanOrEqual(1600);
    });
});
