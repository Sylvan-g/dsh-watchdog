/**
 * dsh-watchdog 核心类型定义
 *
 * 修复 C3：事件类型对齐真实 dsh SessionEventMap
 * - tool/call: { turn, step, callId, name, arguments }
 * - tool/result: { turn, step, message: ToolResultMessage, error?: { name, code }, meta? }
 * - assistant/message: { turn, step, message: AssistantMessage, usage?: TokenUsage }
 *
 * ToolResultMessage.content 是 ContentBlock[] 数组，不是 string
 * TokenUsage 在 assistant/message 事件上，不在 tool/result 上
 */
/** 从 ContentBlock[] 中提取纯文本 */
export function extractTextFromBlocks(blocks) {
    if (!blocks)
        return '';
    if (typeof blocks === 'string')
        return blocks;
    const parts = [];
    for (const block of blocks) {
        if (block.type === 'text') {
            parts.push(block.text);
        }
        else if (block.type === 'tool_result') {
            if (typeof block.content === 'string') {
                parts.push(block.content);
            }
            else if (Array.isArray(block.content)) {
                parts.push(extractTextFromBlocks(block.content));
            }
        }
    }
    return parts.join('\n');
}
/** 判断 ContentBlock[] 是否表示错误 */
export function isErrorContent(blocks) {
    if (!blocks)
        return false;
    return blocks.some(b => b.type === 'tool_result' && b.is_error === true);
}
/** 默认配置 */
export const DEFAULT_CONFIG = {
    enabled: true,
    loopGuard: {
        enabled: true,
        windowK: 5,
        dedupSoft: 0.6,
        dedupHard: 0.9,
        infoGain: 0.2,
        stallSteps: 3,
    },
    toolRetry: {
        enabled: true,
        maxRetries: 3,
        backoffMs: [1000, 3000, 9000],
    },
    contextGuard: {
        enabled: true,
        softTokens: 80000,
        hardTokens: 110000,
    },
    actions: {
        nudgeSteps: 3,
    },
};
/** 从 payload 中安全提取 agent */
export function extractAgent(payload) {
    return payload.agent;
}
/** 从 payload 中安全提取 session events */
export function extractEvents(payload) {
    const agent = extractAgent(payload);
    return agent?.session?.events ?? [];
}
//# sourceMappingURL=types.js.map