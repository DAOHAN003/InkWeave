import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

// ── 布局常量（改版规范）──────────────────────────────
const LEFT_DEFAULT = 240;
const LEFT_MIN = 180;
const LEFT_MAX = 320;
const MID_DEFAULT = 300;
const MID_MIN = 220;
const MID_MAX = 420;
const LAYOUT_KEY = 'fuxiloom.layout';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function loadLayout(): { left: number; mid: number; focus: boolean } {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const o = JSON.parse(raw) as { left?: number; mid?: number; focus?: boolean };
      return {
        left: clamp(Number(o.left) || LEFT_DEFAULT, LEFT_MIN, LEFT_MAX),
        mid: clamp(Number(o.mid) || MID_DEFAULT, MID_MIN, MID_MAX),
        focus: !!o.focus,
      };
    }
  } catch {
    /* 解析失败用默认 */
  }
  return { left: LEFT_DEFAULT, mid: MID_DEFAULT, focus: false };
}

/**
 * 布局域 —— 三栏宽度、专注模式与分栏拖拽，全部持久化到 localStorage。
 *
 * 自 App.tsx 抽出（2026-10-06 巨石治理）：原先常量、状态、持久化 effect 与拖拽
 * 分散在主组件四处，现合并为单一域，与业务状态解耦。
 */
export function useAppLayout() {
  const initLayout = useMemo(() => loadLayout(), []);
  const [leftW, setLeftW] = useState(initLayout.left);
  const [midW, setMidW] = useState(initLayout.mid);
  const [focusMode, setFocusMode] = useState(initLayout.focus);
  const [dragging, setDragging] = useState<'left' | 'mid' | null>(null);
  const dragRef = useRef<{ which: 'left' | 'mid'; startX: number; startW: number } | null>(null);

  // 布局持久化
  useEffect(() => {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ left: leftW, mid: midW, focus: focusMode }));
    } catch {
      /* 忽略写入失败 */
    }
  }, [leftW, midW, focusMode]);

  // 分栏拖拽：mousedown 记起点，全局 mousemove 跟随，mouseup 收尾
  const startDrag = useCallback(
    (which: 'left' | 'mid') => (e: ReactMouseEvent) => {
      e.preventDefault();
      dragRef.current = { which, startX: e.clientX, startW: which === 'left' ? leftW : midW };
      setDragging(which);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [leftW, midW],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const delta = e.clientX - d.startX;
      if (d.which === 'left') setLeftW(clamp(d.startW + delta, LEFT_MIN, LEFT_MAX));
      else setMidW(clamp(d.startW + delta, MID_MIN, MID_MAX));
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setDragging(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return { leftW, midW, focusMode, setFocusMode, dragging, startDrag };
}
