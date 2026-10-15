/**
 * 命令面板（⌘K / Ctrl+K）
 * 用 cmdk 实现全局命令跳转：打开各功能面板、切换主题、专注模式、AI 写本章等。
 * 命令列表由 App 注入（复用既有 handler），本组件只负责渲染与交互。
 */

import React, { useEffect, useMemo } from 'react';
import { Command } from 'cmdk';

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon?: React.ReactNode;
  perform: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
  commands: CommandItem[];
}

export const CommandPalette: React.FC<Props> = ({ open, onClose, commands }) => {
  const groups = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const c of commands) {
      if (!map.has(c.group)) map.set(c.group, []);
      map.get(c.group)!.push(c);
    }
    return Array.from(map.entries());
  }, [commands]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[18vh]"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" />
      <div
        className="relative w-[580px] max-w-[92vw] rounded-lg border border-line bg-surface text-content fx-panel-shadow overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Command label={t_label} loop className="cmdk-root">
          <Command.Input
            autoFocus
            placeholder={t_placeholder}
            className="cmdk-input"
          />
          <Command.List className="cmdk-list">
            <Command.Empty className="cmdk-empty">无匹配命令</Command.Empty>
            {groups.map(([name, items]) => (
              <Command.Group key={name} heading={name} className="cmdk-group">
                {items.map((it) => (
                  <Command.Item
                    key={it.id}
                    value={`${it.group} ${it.label}`}
                    onSelect={() => {
                      it.perform();
                      onClose();
                    }}
                    className="cmdk-item"
                  >
                    {it.icon && <span className="cmdk-item-icon">{it.icon}</span>}
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.hint && <span className="cmdk-item-hint">{it.hint}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
};

const t_label = '命令面板';
const t_placeholder = '输入命令，或搜索功能…';
