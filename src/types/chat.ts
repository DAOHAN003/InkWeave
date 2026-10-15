/**
 * 精简聊天消息类型
 *
 * 仅保留 wanxiang/outlineTree.ts 所需的 ChatMessage。
 */

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
}
