/**
 * R4 AI 插图生成面板（V7.1.0）
 *
 * 流程：提炼场景（LLM 结构化，可跳过走朴素降级）→ 编辑 prompt →
 * 生成（确定性 seed，变体 +1 派生新 seed）→ 预览 → 保存落盘 +
 * 回写章节 meta（chapter 插图）/ 作品封面（cover）。
 *
 * 确定性哲学：同一作品同一章节同一变体 = 同一 seed——端点支持 seed
 * 时同图可复现；「换一张」显式递增变体，不偷偷换脸。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, CheckCircle2, FileImage, Loader2, RefreshCw, Sparkles, Trash2 } from '../icons';
import { Modal, Button, TextArea, Select } from '../UI';
import { useToast } from '../UI/Toast';
import { useLang, t } from '../../i18n';
import {
    extractSceneDescriptor,
    naiveSceneFromText,
    buildImagePrompt,
    illustrationSeed,
    illustrationFileName,
    type ChapterIllustration,
    type IllustrationKind,
    type SceneDescriptor,
} from '../../engines/wanxiang/illustration';
import {
    generateImage,
    getImageGenConfig,
    writeIllustrationFile,
    readIllustrationDataUrl,
    deleteIllustrationFile,
    IMAGE_SIZES,
} from '../../utils/ai/imageGen';
import { normalizeErrorMessage } from '../../utils/ai/config';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    novelId: string;
    kind: IllustrationKind;
    /** chapter 模式必填；cover 模式可空 */
    chapterId?: string;
    /** 展示用标题（章节名 / 书名） */
    targetTitle?: string;
    /** 素材文本：章节正文（chapter）/ 书名+简介+类型（cover） */
    sourceText: string;
    /** 已有插图（重生成 / 移除） */
    existing?: ChapterIllustration | null;
    styleHint?: string;
    onSaved: (ill: ChapterIllustration) => void;
    onRemoved?: () => void;
}

type Phase = 'idle' | 'describing' | 'editing' | 'generating' | 'preview';

export const IllustrationPanel: React.FC<Props> = ({
    isOpen,
    onClose,
    novelId,
    kind,
    chapterId,
    targetTitle,
    sourceText,
    existing,
    styleHint,
    onSaved,
    onRemoved,
}) => {
    const lang = useLang();
    const toast = useToast();

    const [phase, setPhase] = useState<Phase>('idle');
    const [descriptor, setDescriptor] = useState<SceneDescriptor | null>(null);
    const [prompt, setPrompt] = useState('');
    const [seed, setSeed] = useState(0);
    const [variant, setVariant] = useState(0);
    const [size, setSize] = useState<string>(kind === 'cover' ? '1024x1792' : getImageGenConfig().size);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
    const [existingUrl, setExistingUrl] = useState<string | null>(null);
    const [error, setError] = useState('');
    const abortRef = useRef<AbortController | null>(null);

    const isChapter = kind === 'chapter';

    // 打开时初始化：已有插图 → 展示 + prompt/seed 回填；否则进入 idle
    useEffect(() => {
        if (!isOpen) return;
        setError('');
        setPreviewUrl(null);
        setPreviewBytes(null);
        abortRef.current?.abort();
        if (existing) {
            setPhase('editing');
            setDescriptor(existing.scene ? { scene: existing.scene, subject: '', mood: '', styleTags: [], negative: '' } : null);
            setPrompt(existing.prompt);
            setSeed(existing.seed);
            setVariant(0);
            setExistingUrl(null);
            readIllustrationDataUrl(existing.file).then((url) => {
                if (url) setExistingUrl(url);
            });
        } else {
            setPhase('idle');
            setDescriptor(null);
            setPrompt('');
            setVariant(0);
            setSeed(illustrationSeed(novelId, kind, chapterId || '', 0));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, novelId, kind, chapterId]);

    // 释放 objectURL
    useEffect(() => {
        return () => {
            if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
        };
    }, [previewUrl]);

    const config = useMemo(() => getImageGenConfig(), []);

    const runDescribe = async () => {
        setError('');
        setPhase('describing');
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const r = await extractSceneDescriptor(sourceText, kind, controller.signal);
            const d = r ? r.descriptor : naiveSceneFromText(sourceText, kind);
            setDescriptor(d);
            setPrompt(buildImagePrompt(d, kind, styleHint));
            setPhase('editing');
            if (!r) toast.info(t('场景提炼降级：已用正文直接构造', lang));
        } catch (err) {
            const d = naiveSceneFromText(sourceText, kind);
            setDescriptor(d);
            setPrompt(buildImagePrompt(d, kind, styleHint));
            setPhase('editing');
            toast.info(t('场景提炼失败，已用正文直接构造', lang) + '：' + normalizeErrorMessage(err));
        }
    };

    const runGenerate = async (nextVariant?: number) => {
        if (!prompt.trim()) {
            setError(t('prompt 不能为空', lang));
            return;
        }
        setError('');
        const v = nextVariant ?? variant;
        const useSeed = illustrationSeed(novelId, kind, chapterId || '', v);
        setVariant(v);
        setSeed(useSeed);
        setPhase('generating');
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const img = await generateImage({
                prompt: prompt.trim(),
                seed: useSeed,
                size,
                signal: controller.signal,
            });
            if (previewUrl && previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
            const url = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: 'image/png' }));
            setPreviewUrl(url);
            setPreviewBytes(img.bytes);
            setExistingUrl(null);
            setPhase('preview');
            if (!img.seedSent) toast.info(t('该端点不支持 seed，图像将不可复现', lang));
        } catch (err) {
            setError(normalizeErrorMessage(err));
            setPhase('editing');
        }
    };

    const runSave = async () => {
        if (!previewBytes) return;
        const name = illustrationFileName(kind, chapterId || novelId, seed);
        try {
            const slot = await writeIllustrationFile(novelIdSafe(novelId), name, previewBytes);
            const ill: ChapterIllustration = {
                seed,
                file: slot.relPath,
                prompt: prompt.trim(),
                scene: descriptor?.scene,
                kind,
                createdAt: new Date().toISOString(),
            };
            onSaved(ill);
            toast.success(kind === 'cover' ? t('封面已保存', lang) : t('插图已保存', lang));
            onClose();
        } catch (err) {
            setError(t('插图文件写入失败', lang) + '：' + normalizeErrorMessage(err));
        }
    };

    const runRemove = async () => {
        if (!existing) return;
        if (existing.file) await deleteIllustrationFile(existing.file);
        onRemoved?.();
        toast.success(t('已移除插图', lang));
        onClose();
    };

    const title = kind === 'cover' ? t('AI 封面', lang) : t('AI 插图', lang);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`${title}${targetTitle ? ` · ${targetTitle}` : ''}`} size="lg">
            <div className="p-4 space-y-4">
                {/* 配置态提示 */}
                <div className="flex items-start gap-2 text-xs text-content-muted">
                    <Camera className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <span>
                        {t('图像服务', lang)}：
                        <span className="text-content">{config.baseUrl || t('未配置', lang)}</span>
                        {config.model ? ` · ${config.model}` : ''}
                        {config.baseUrl ? '' : ` —— ${t('在「模型与 API」中配置后可用', lang)}`}
                    </span>
                </div>

                {/* 已有插图展示 */}
                {existing && existingUrl && !previewUrl && (
                    <div className="space-y-1.5">
                        <div className="text-xs text-content-muted">{t('当前插图', lang)}</div>
                        <img
                            src={existingUrl}
                            alt={t('当前插图', lang)}
                            className={`w-full rounded-lg border border-line ${kind === 'cover' ? 'max-w-[280px] mx-auto' : 'max-h-[38vh] object-contain'}`}
                        />
                    </div>
                )}

                {/* idle：入口 */}
                {phase === 'idle' && (
                    <div className="space-y-3">
                        <div className="text-sm text-content">
                            {isChapter
                                ? t('从本章正文提炼一个最有画面感的瞬间，生成英文视觉 prompt 后出图。', lang)
                                : t('从书名与简介提炼封面构图，生成英文视觉 prompt 后出图。', lang)}
                        </div>
                        <div className="flex items-center gap-2">
                            <Button onClick={runDescribe} disabled={!sourceText.trim()}>
                                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                                {t('提炼场景', lang)}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    const d = naiveSceneFromText(sourceText, kind);
                                    setDescriptor(d);
                                    setPrompt(buildImagePrompt(d, kind, styleHint));
                                    setPhase('editing');
                                }}
                                disabled={!sourceText.trim()}
                            >
                                {t('跳过提炼，直接编辑', lang)}
                            </Button>
                        </div>
                        {!sourceText.trim() && (
                            <div className="text-xs text-warning flex items-center gap-1.5">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {isChapter ? t('本章正文为空，先写点什么再配插图吧。', lang) : t('作品信息不足，先补全书名与简介。', lang)}
                            </div>
                        )}
                    </div>
                )}

                {/* describing */}
                {phase === 'describing' && (
                    <div className="py-10 flex flex-col items-center gap-2 text-content-muted text-sm">
                        <Loader2 className="w-5 h-5 fx-spin" />
                        {t('正在提炼场景要素……', lang)}
                    </div>
                )}

                {/* editing / generating / preview：prompt 编辑区 */}
                {(phase === 'editing' || phase === 'generating' || phase === 'preview') && (
                    <>
                        <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                                <label className="text-xs text-content-muted">{t('图像 Prompt（英文，可编辑）', lang)}</label>
                                <span className="text-[11px] text-content-muted font-mono">
                                    seed {seed.toString(36)} · {t('变体', lang)} #{variant}
                                </span>
                            </div>
                            <TextArea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                rows={kind === 'cover' ? 4 : 5}
                                placeholder="English image prompt..."
                            />
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Select
                                value={size}
                                onChange={(e) => setSize(e.target.value)}
                                options={IMAGE_SIZES.map((s) => ({ value: s, label: s }))}
                                className="!w-auto"
                            />
                            <Button onClick={() => runGenerate(variant)} disabled={phase === 'generating' || !prompt.trim()}>
                                {phase === 'generating' ? <Loader2 className="w-3.5 h-3.5 mr-1.5 fx-spin" /> : <FileImage className="w-3.5 h-3.5 mr-1.5" />}
                                {phase === 'generating' ? t('生成中……', lang) : existing || previewUrl ? t('重新生成', lang) : t('生成插图', lang)}
                            </Button>
                            {(previewUrl || existing) && (
                                <Button variant="outline" onClick={() => runGenerate(variant + 1)} disabled={phase === 'generating' || !prompt.trim()}>
                                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                    {t('换一张', lang)}
                                </Button>
                            )}
                            {existing && (
                                <Button variant="danger" onClick={runRemove} disabled={phase === 'generating'}>
                                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                    {t('移除插图', lang)}
                                </Button>
                            )}
                        </div>

                        {/* 生成中 */}
                        {phase === 'generating' && (
                            <div className="py-10 flex flex-col items-center gap-2 text-content-muted text-sm">
                                <Loader2 className="w-5 h-5 fx-spin" />
                                {t('正在生成图像（可能需要十几秒）……', lang)}
                            </div>
                        )}

                        {/* 预览 */}
                        {phase === 'preview' && previewUrl && (
                            <div className="space-y-2">
                                <div className="text-xs text-content-muted flex items-center gap-1.5">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                                    {t('生成完成——满意就保存，不满意可编辑后重新生成。', lang)}
                                </div>
                                <img
                                    src={previewUrl}
                                    alt={t('插图预览', lang)}
                                    className={`w-full rounded-lg border border-line ${kind === 'cover' ? 'max-w-[280px] mx-auto' : 'max-h-[40vh] object-contain'}`}
                                />
                                <div className="flex items-center gap-2">
                                    <Button onClick={runSave}>
                                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                                        {kind === 'cover' ? t('保存为封面', lang) : t('保存为章节插图', lang)}
                                    </Button>
                                </div>
                            </div>
                        )}

                        {/* 错误 */}
                        {error && (
                            <div className="px-3 py-2 rounded-md bg-danger/10 text-danger text-sm border border-danger/30 break-words">
                                {error}
                            </div>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
};

/** novelId 清洗（目录名安全） */
const novelIdSafe = (id: string): string => String(id || 'novel').replace(/[^\w.-]+/g, '_').slice(0, 48);
