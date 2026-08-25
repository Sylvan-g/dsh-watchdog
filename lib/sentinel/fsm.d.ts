/**
 * 三态状态机：NORMAL → SUSPECTED → CONFIRMED
 *
 * 状态转移规则：
 * - NORMAL → SUSPECTED：去重率 > dedupSoft 或 信息增量 < infoGain
 * - SUSPECTED → NORMAL：去重率 <= dedupSoft（Agent 在尝试不同策略，恢复）
 * - SUSPECTED → CONFIRMED：连续停滞步数 >= stallSteps 或 去重率 > dedupHard
 * - CONFIRMED 是终态，不再转移
 *
 * 纯函数，零依赖，可单测。
 */
import type { LoopState, ProgressMetrics, LoopGuardConfig } from './types.js';
/** 状态机内部状态（含停滞计数器） */
export interface FsmState {
    /** 当前状态 */
    current: LoopState;
    /** SUSPECTED 状态下连续无进展的步数 */
    stalledSteps: number;
    /** 进入 SUSPECTED 状态的步号（用于诊断报告） */
    suspectedSinceStep: number;
}
/** 初始状态 */
export declare const INITIAL_FSM_STATE: FsmState;
/**
 * 根据进展度量推进状态机
 *
 * @param state 当前状态机状态
 * @param metrics 当前步的进展度量
 * @param config loop guard 配置
 * @param step 当前步号（用于记录 suspectedSinceStep）
 * @returns 新的状态机状态
 */
export declare function transition(state: FsmState, metrics: ProgressMetrics, config: LoopGuardConfig, step: number): FsmState;
/**
 * 重置状态机到初始状态
 */
export declare function resetFsm(): FsmState;
/**
 * 判断给定状态是否需要触发动作链
 */
export declare function shouldAct(state: FsmState): boolean;
//# sourceMappingURL=fsm.d.ts.map