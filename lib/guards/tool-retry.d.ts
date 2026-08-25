/**
 * 工具失败重试与降级守卫（tool-retry）
 *
 * 挂载 tools/post-execute 事件，在工具调用失败时：
 * 1. 重试：指数退避重试同工具（可配最大次数）
 * 2. 换备用工具：若声明了等价备用工具，切换
 * 3. 只读兜底：降级为只读查询类工具
 * 4. 交还用户：仍失败则终止该工具链，交还用户决策
 *
 * 基于 dsh 架构文档 §13.2，工具失败走 ctx.tools 三个事件：
 * - tools/pre-execute：拦截决策
 * - tools/execute：实际执行（可包超时/重试）
 * - tools/post-execute：结果处理
 */
import type { WatchdogConfig, ToolExecutionContext, ToolExecutionResult } from '../sentinel/types.js';
/** 工具重试状态跟踪 */
export interface ToolRetryState {
    /** 每个工具的当前重试次数 */
    retryCount: Map<string, number>;
    /** 备用工具映射 */
    fallbackMap: Map<string, string[]>;
    /** 降级链当前层级 */
    degradationLevel: Map<string, 'retry' | 'fallback' | 'readonly' | 'surrender'>;
}
/**
 * 创建 tool-retry 守卫
 */
export declare function createToolRetryGuard(config: WatchdogConfig): {
    handleResult: (ctx: ToolExecutionContext, result: ToolExecutionResult) => ToolRetryDecision;
    registerFallback: (toolName: string, fallbacks: string[]) => void;
    getBackoffDelay: (retryCount: number) => number;
    reset: () => void;
    readonly state: {
        retryCount: Map<string, number>;
        fallbackMap: Map<string, string[]>;
        degradationLevel: Map<string, "fallback" | "readonly" | "retry" | "surrender">;
    };
};
/** 工具重试决策 */
export type ToolRetryDecision = {
    kind: 'accept';
    content?: string;
} | {
    kind: 'retry';
    delay: number;
    attempt: number;
} | {
    kind: 'fallback';
    fallbackTool: string;
    reason: string;
} | {
    kind: 'readonly';
    reason: string;
} | {
    kind: 'block';
    feedback: string;
    surrender: boolean;
};
//# sourceMappingURL=tool-retry.d.ts.map