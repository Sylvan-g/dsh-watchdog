/**
 * 上下文膨胀守卫（context-guard）
 *
 * 监控当前上下文 token 用量：
 * - 超过软阈值时，注入摘要压缩指令（通过 agent.steer 或 seed patch）
 * - 超过硬阈值时，限制 maxTokens + 标记需要历史裁剪
 *
 * 修复 C3：token 用量从 assistant/message.data.usage 读取
 * 修复 M5：软阈值实际注入压缩提示，硬阈值限制 maxTokens 并标记裁剪
 *
 * 挂载点：
 * - agent/request：读取 token 计数，判断是否超阈值
 * - agent/request-error：捕获 CONTEXT_WINDOW_EXCEEDED，触发紧急裁剪
 */
import type { WatchdogConfig, AgentRequestPayload, LlmCallConfig, SessionEvent } from '../sentinel/types.js';
/** 上下文守卫状态 */
export interface ContextGuardState {
    /** 当前估算的 token 用量 */
    estimatedTokens: number;
    /** 是否已触发软阈值 */
    softTriggered: boolean;
    /** 是否已触发硬阈值 */
    hardTriggered: boolean;
    /** 累计压缩次数 */
    compressionCount: number;
}
/**
 * 创建 context-guard
 */
export declare function createContextGuard(config: WatchdogConfig): {
    handleRequest: (payload: AgentRequestPayload, next: () => Promise<LlmCallConfig>) => Promise<ContextGuardResult>;
    handleRequestError: (failure: {
        message: string;
        code?: string;
    }) => "retry" | undefined;
    getCompressionPrompt: () => string | null;
    estimateTokens: (events: readonly SessionEvent[]) => number;
    reset: () => void;
    readonly state: {
        /** 当前估算的 token 用量 */
        estimatedTokens: number;
        /** 是否已触发软阈值 */
        softTriggered: boolean;
        /** 是否已触发硬阈值 */
        hardTriggered: boolean;
        /** 累计压缩次数 */
        compressionCount: number;
    };
};
/** 上下文守卫返回结果 */
export interface ContextGuardResult {
    seed: LlmCallConfig;
    /** 软/硬阈值触发的压缩提示（需注入到 agent.steer） */
    compressionPrompt: string | null;
    /** 是否需要历史裁剪（硬阈值） */
    needsTrim: boolean;
}
//# sourceMappingURL=context-guard.d.ts.map