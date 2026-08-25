/**
 * L1 纠偏动作（nudge）
 *
 * 通过 agent/request waterfall 注入纠偏提示，
 * 让模型自我修正行为。观察 N 步是否恢复。
 */
import type { WatchdogConfig, ProgressMetrics } from '../sentinel/types.js';
/** 纠偏结果 */
export type NudgeResult = 'recovered' | 'failed';
/**
 * 创建 L1 纠偏动作
 */
export declare function createNudge(config: WatchdogConfig): {
    inject: (trigger: string) => string;
    checkRecovery: (metrics: ProgressMetrics) => "observing" | NudgeResult;
    reset: () => void;
    readonly nudged: boolean;
    readonly stepsSinceNudge: number;
};
//# sourceMappingURL=nudge.d.ts.map