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
import type { SessionEvent, ProgressMetrics, LoopGuardConfig } from './types.js';
/**
 * 生成动作签名：工具名 + 归一化后的参数
 * 归一化：去除参数中的动态值（数字、UUID、时间戳、路径等），只保留结构
 *
 * 修复 M6：路径归一化改为只替换整个字符串值是路径的情况，
 * 不再对"包含路径片段的字符串"做整体替换，避免误判。
 */
export declare function actionSignature(name: string, args: string): string;
/**
 * 计算信息增量：新内容 n-gram 中不在历史 n-gram 中的比例
 * 返回 [0, 1]，1 = 全新信息，0 = 完全重复
 */
export declare function computeInfoGain(newContent: string, historyContents: string[]): number;
/**
 * 计算进展度量（主函数）
 *
 * @param events 完整的 session.events 列表
 * @param config loop guard 配置
 * @returns 进展度量结果
 */
export declare function computeMetrics(events: readonly SessionEvent[], config: LoopGuardConfig): ProgressMetrics;
//# sourceMappingURL=metrics.d.ts.map