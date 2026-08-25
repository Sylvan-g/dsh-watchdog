/**
 * 进展度量引擎
 *
 * 对滑动窗口内的 tool/call + tool/result + assistant/message 事件计算三个核心信号：
 * 1. 动作去重率（dedupRatio）— 从 tool/call.data.name + arguments
 * 2. 信息增量（infoGain）— 从 tool/result.data.message.content (ContentBlock[])
 * 3. token 消耗斜率（tokenSlope）— 从 assistant/message.data.usage
 *
 * 修复 C3：对齐真实 dsh 事件结构
 * - tool/result 的文本内容在 data.message.content (ContentBlock[])，不在 data.content
 * - token 用量在 assistant/message.data.usage，不在 tool/result.data.usage
 *
 * 纯函数，零外部依赖，可单测。
 */
import { extractTextFromBlocks } from './types.js';
// ─── 工具函数 ───
/**
 * 生成动作签名：工具名 + 归一化后的参数
 * 归一化：去除参数中的动态值（数字、UUID、时间戳、路径等），只保留结构
 *
 * 修复 M6：路径归一化改为只替换整个字符串值是路径的情况，
 * 不再对"包含路径片段的字符串"做整体替换，避免误判。
 */
export function actionSignature(name, args) {
    try {
        const parsed = JSON.parse(args);
        const normalized = normalizeArguments(parsed);
        return `${name}(${JSON.stringify(normalized)})`;
    }
    catch {
        // 参数非 JSON，直接用 name + 截断后的原始参数
        return `${name}(${truncate(args, 100)})`;
    }
}
/**
 * 归一化参数：将动态值替换为占位符，保留结构
 */
function normalizeArguments(obj) {
    if (obj === null || obj === undefined)
        return obj;
    if (typeof obj === 'string') {
        // UUID
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(obj)) {
            return '<uuid>';
        }
        // 绝对路径：整个字符串以 / 或 X:\ 开头
        if (/^(\/[^\s]*|[A-Z]:\\[^\s]*)/.test(obj))
            return '<path>';
        // 长数字串（如文件 inode、时间戳毫秒）
        if (/^\d{10,}$/.test(obj))
            return '<timestamp>';
        return obj;
    }
    if (typeof obj === 'number')
        return '<num>';
    if (typeof obj === 'boolean')
        return obj;
    if (Array.isArray(obj))
        return obj.map(normalizeArguments);
    if (typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = normalizeArguments(value);
        }
        return result;
    }
    return obj;
}
function truncate(str, maxLen) {
    return str.length > maxLen ? str.slice(0, maxLen) + '...' : str;
}
// ─── n-gram 信息增量 ───
/**
 * 计算字符级 n-gram 集合
 */
function charNgrams(text, n = 3) {
    const ngrams = new Set();
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    for (let i = 0; i <= normalized.length - n; i++) {
        ngrams.add(normalized.slice(i, i + n));
    }
    return ngrams;
}
/**
 * 计算信息增量：新内容 n-gram 中不在历史 n-gram 中的比例
 * 返回 [0, 1]，1 = 全新信息，0 = 完全重复
 */
export function computeInfoGain(newContent, historyContents) {
    if (!newContent || newContent.trim().length === 0)
        return 0;
    if (historyContents.length === 0)
        return 1;
    const newNgrams = charNgrams(newContent);
    if (newNgrams.size === 0)
        return 0;
    const historyNgrams = new Set();
    for (const content of historyContents) {
        for (const ng of charNgrams(content)) {
            historyNgrams.add(ng);
        }
    }
    let novelCount = 0;
    for (const ng of newNgrams) {
        if (!historyNgrams.has(ng))
            novelCount++;
    }
    return novelCount / newNgrams.size;
}
// ─── 从真实 dsh 事件提取文本 ───
/**
 * 从 tool/result 事件提取文本内容
 * 对齐 dsh SessionEventMap：data.message.content 是 ContentBlock[]
 */
function extractToolResultText(event) {
    if (event.type === 'tool/result') {
        return extractTextFromBlocks(event.data.message?.content);
    }
    return '';
}
/**
 * 从 assistant/message 事件提取 token 用量
 * 对齐 dsh SessionEventMap：usage 在 assistant/message 上
 */
function extractTokenUsage(events) {
    const usages = [];
    for (const event of events) {
        if (event.type === 'assistant/message' && event.data.usage) {
            usages.push({
                inputTokens: event.data.usage.inputTokens ?? 0,
                outputTokens: event.data.usage.outputTokens ?? 0,
            });
        }
        // 兼容：也检查 turn/end 事件上的 usage
        if (event.type === 'turn/end' && event.data.usage) {
            usages.push({
                inputTokens: event.data.usage.inputTokens ?? 0,
                outputTokens: event.data.usage.outputTokens ?? 0,
            });
        }
    }
    return usages;
}
// ─── 核心度量函数 ───
/**
 * 提取滑动窗口内的 tool/call 事件
 */
function extractToolCalls(events, windowK) {
    const toolCalls = events.filter((e) => e.type === 'tool/call');
    return toolCalls.slice(-windowK);
}
/**
 * 提取滑动窗口内对应 tool/result 事件
 */
function extractToolResults(events, windowK) {
    const toolResults = events.filter((e) => e.type === 'tool/result');
    return toolResults.slice(-windowK);
}
/**
 * 计算动作去重率
 */
function computeDedupRatio(toolCalls) {
    if (toolCalls.length === 0)
        return { ratio: 0, topSignatures: [] };
    const sigCount = new Map();
    for (const event of toolCalls) {
        if (event.type === 'tool/call') {
            const sig = actionSignature(event.data.name, event.data.arguments);
            sigCount.set(sig, (sigCount.get(sig) ?? 0) + 1);
        }
    }
    const sorted = [...sigCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([signature, count]) => ({ signature, count }));
    const maxCount = sorted[0]?.count ?? 0;
    const ratio = maxCount / toolCalls.length;
    return { ratio, topSignatures: sorted.slice(0, 5) };
}
/**
 * 计算窗口内平均信息增量
 * 从 tool/result.data.message.content (ContentBlock[]) 提取文本
 */
function computeWindowInfoGain(toolResults, allHistoryResults) {
    if (toolResults.length === 0)
        return 1;
    const recentContents = [];
    for (const event of toolResults) {
        recentContents.push(extractToolResultText(event));
    }
    if (recentContents.length === 0)
        return 1;
    // 窗口之前的历史内容
    const preWindowContents = allHistoryResults
        .slice(0, -toolResults.length)
        .filter((e) => e.type === 'tool/result')
        .map((e) => extractToolResultText(e));
    // 窗口内渐进式比较
    let totalGain = 0;
    const accumulatedHistory = [...preWindowContents];
    for (const content of recentContents) {
        totalGain += computeInfoGain(content, accumulatedHistory);
        accumulatedHistory.push(content);
    }
    return totalGain / recentContents.length;
}
/**
 * 计算 token 消耗斜率
 * 从 assistant/message.data.usage 提取 token 用量（修复 C3）
 */
function computeTokenSlope(events, windowK) {
    const allUsages = extractTokenUsage(events);
    const recentUsages = allUsages.slice(-windowK);
    if (recentUsages.length === 0)
        return 0;
    let totalOutputTokens = 0;
    let stepsWithOutput = 0;
    for (const usage of recentUsages) {
        totalOutputTokens += usage.outputTokens;
        if (usage.outputTokens > 0)
            stepsWithOutput++;
    }
    if (stepsWithOutput === 0)
        return 0;
    return totalOutputTokens / recentUsages.length;
}
/**
 * 计算进展度量（主函数）
 *
 * @param events 完整的 session.events 列表
 * @param config loop guard 配置
 * @returns 进展度量结果
 */
export function computeMetrics(events, config) {
    const windowK = config.windowK;
    const toolCalls = extractToolCalls(events, windowK);
    const toolResults = extractToolResults(events, windowK);
    const allResults = events.filter((e) => e.type === 'tool/result');
    const { ratio: dedupRatio, topSignatures } = computeDedupRatio(toolCalls);
    const infoGain = computeWindowInfoGain(toolResults, allResults);
    const tokenSlope = computeTokenSlope(events, windowK);
    return {
        dedupRatio,
        infoGain,
        tokenSlope,
        windowSize: toolCalls.length,
        topSignatures,
    };
}
//# sourceMappingURL=metrics.js.map