import { useEffect, useState } from 'react';
import { loadTheme, saveTheme, applyTheme, AUTO_THEME_KEY } from '../../theme';

/**
 * 主题域 —— 全局 <html> 级主题的读取、应用与持久化，并让「自动」模式实时跟随系统深浅色。
 *
 * 自 App.tsx 抽出（2026-10-06 巨石治理）。
 */
export function useTheme() {
  const [theme, setTheme] = useState<string>(loadTheme());
  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  // 系统深浅色变化时，「自动」模式实时跟随（非 auto 模式忽略）
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      setTheme((cur) => {
        if (cur !== AUTO_THEME_KEY) return cur;
        applyTheme(AUTO_THEME_KEY);
        return cur;
      });
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  return { theme, setTheme };
}
