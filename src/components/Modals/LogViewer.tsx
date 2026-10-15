import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Modal } from '../UI';

interface LogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function LogViewer({ isOpen, onClose }: LogViewerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await invoke('wx_log_read', { lines: 400 })) as string[];
      setLines(data);
    } catch (e) {
      setError(`读取日志失败：${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, refresh]);

  const copyAll = useCallback(async () => {
    if (lines.length === 0) return;
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败：浏览器/运行时拒绝了剪贴板访问，请手动到日志目录复制。');
    }
  }, [lines]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="运行日志" size="xl">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs text-content-secondary">
          <span>运行时错误与崩溃会记录到本地文件，便于排查问题。</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={copyAll}
              disabled={lines.length === 0}
              className="px-2 py-1 rounded bg-surface-hover hover:bg-surface text-content-secondary hover:text-content transition-colors disabled:opacity-40"
            >
              {copied ? '已复制' : '复制全部'}
            </button>
            <button
              type="button"
              onClick={refresh}
              className="px-2 py-1 rounded bg-surface-hover hover:bg-surface text-content-secondary hover:text-content transition-colors"
            >
              刷新
            </button>
          </div>
        </div>

        {error && (
          <div className="text-xs text-[rgb(var(--danger))]">{error}</div>
        )}

        <div
          className="rounded-lg border border-line bg-[rgb(var(--code-bg))] p-3 font-mono text-[12px] leading-relaxed text-content overflow-auto"
          style={{ maxHeight: '60vh', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        >
          {loading ? '加载中…' : lines.length === 0 ? '暂无日志。' : lines.join('\n')}
        </div>

        <div className="text-[11px] text-content-muted">
          文件路径：{'<app_data_dir>/logs/app.log'}（崩溃日志在 panic.log）。可直接到该目录查看完整记录。
        </div>
      </div>
    </Modal>
  );
}
