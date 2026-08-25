/**
 * 多级降级动作链编排
 *
 * 检测到异常时按代价递增逐级执行：
 * L1 纠偏（nudge）→ L2 降级（downgrade）→ L3 停止（stop）
 *
 * 前一级失败自动进入下一级。
 */
import type { WatchdogConfig, AgentRequestPayload, LlmCallConfig, DiagnosticReport } from '../sentinel/types.js';
import { type NudgeResult } from './nudge.js';
import { type DowngradeResult } from './downgrade.js';
/** 动作链当前级别 */
export type ActionLevel = 'none' | 'L1' | 'L2' | 'L3';
/** 动作链执行结果 */
export interface ActionChainResult {
    /** 当前级别 */
    level: ActionLevel;
    /** 需要注入到 seed 的补丁 */
    patch: Record<string, unknown>;
    /** 是否已终止 */
    terminated: boolean;
    /** 诊断报告（仅 L3 终止时生成） */
    report?: DiagnosticReport;
    /** 纠偏提示（仅 L1 时有值） */
    nudgePrompt?: string;
}
/**
 * 创建动作链编排器
 */
export declare function createActionChain(config: WatchdogConfig): {
    execute: (trigger: string, payload: AgentRequestPayload, seed: LlmCallConfig) => ActionChainResult;
    checkRecovery: (metrics: import("../sentinel/types.js").ProgressMetrics) => void;
    reset: () => void;
    readonly currentLevel: ActionLevel;
    readonly nudge: {
        inject: (trigger: string) => string;
        checkRecovery: (metrics: import("../sentinel/types.js").ProgressMetrics) => "observing" | NudgeResult;
        reset: () => void;
        readonly nudged: boolean;
        readonly stepsSinceNudge: number;
    };
    readonly downgrade: {
        apply: (seed: LlmCallConfig) => {
            seed: LlmCallConfig;
            result: DowngradeResult;
        };
        isExhausted: () => boolean;
        reset: () => void;
        readonly currentLevel: number;
        readonly applied: boolean;
    };
    readonly stop: {
        executeHardStop: (agentCancel: (opts: {
            kind: string;
            reason: string;
        }) => void, sessionId?: string, trigger?: string) => import("./stop.js").StopResult;
        executeSoftStop: (agentSteer: (msg: string) => void, sessionId?: string, trigger?: string) => import("./stop.js").StopResult & {
            message: string;
        };
        getReportBuilder: () => import("../index.js").DiagnosticReportBuilder | null;
        reset: () => void;
        readonly stopped: boolean;
    };
};
//# sourceMappingURL=index.d.ts.map