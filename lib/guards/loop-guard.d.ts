/**
 * 死循环 / 无进展检测守卫（loop-guard）
 *
 * 挂载 agent/request waterfall，每步读取 session.events，
 * 通过 SentinelWatch 计算进展度量、推进状态机，
 * 在 CONFIRMED 时触发 Actions 动作链。
 *
 * 修复 H2：handleRequest 返回 LoopGuardResult（含 metrics），供 index.ts 使用
 */
import type { WatchdogConfig, AgentRequestPayload, LlmCallConfig, ProgressMetrics } from '../sentinel/types.js';
import { SentinelWatch } from '../sentinel/watch.js';
/**
 * loop-guard 守卫的内部状态
 */
export interface LoopGuardState {
    /** 是否已触发过 L1 纠偏 */
    nudged: boolean;
    /** 是否已触发过 L2 降级 */
    downgraded: boolean;
    /** 是否已触发过 L3 停止 */
    stopped: boolean;
}
/**
 * loop-guard handleRequest 返回结果
 */
export interface LoopGuardResult {
    /** 修改后的 seed */
    seed: LlmCallConfig;
    /** 当前状态机的度量数据（供 action-chain checkRecovery 使用） */
    metrics: ProgressMetrics | null;
    /** 当前状态 */
    state: string;
    /** 是否需要触发动作链 */
    shouldAct: boolean;
    /** 动作级别 */
    actionLevel?: 'nudge' | 'downgrade' | 'stop';
    /** 诊断快照 */
    diagnostic?: any;
}
/**
 * 创建 loop-guard
 */
export declare function createLoopGuard(config: WatchdogConfig): {
    handleRequest: (payload: AgentRequestPayload, next: () => Promise<LlmCallConfig>) => Promise<LoopGuardResult>;
    reset: () => void;
    readonly state: {
        /** 是否已触发过 L1 纠偏 */
        nudged: boolean;
        /** 是否已触发过 L2 降级 */
        downgraded: boolean;
        /** 是否已触发过 L3 停止 */
        stopped: boolean;
    };
    readonly sentinel: SentinelWatch;
    readonly metrics: ProgressMetrics;
};
//# sourceMappingURL=loop-guard.d.ts.map