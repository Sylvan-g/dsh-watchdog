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
/** 初始状态 */
export const INITIAL_FSM_STATE = {
    current: 'NORMAL',
    stalledSteps: 0,
    suspectedSinceStep: -1,
};
/**
 * 根据进展度量推进状态机
 *
 * @param state 当前状态机状态
 * @param metrics 当前步的进展度量
 * @param config loop guard 配置
 * @param step 当前步号（用于记录 suspectedSinceStep）
 * @returns 新的状态机状态
 */
export function transition(state, metrics, config, step) {
    // CONFIRMED 是终态，不再转移
    if (state.current === 'CONFIRMED') {
        return state;
    }
    if (state.current === 'NORMAL') {
        // NORMAL → SUSPECTED：去重率超过软阈值 或 信息增量低于阈值
        if (metrics.dedupRatio > config.dedupSoft || metrics.infoGain < config.infoGain) {
            return {
                current: 'SUSPECTED',
                stalledSteps: 1,
                suspectedSinceStep: step,
            };
        }
        // 保持 NORMAL
        return { ...state, stalledSteps: 0 };
    }
    if (state.current === 'SUSPECTED') {
        // SUSPECTED → NORMAL：去重率正常（说明工具调用不重复），即使 infoGain 略低也恢复
        // 原因：infoGain 会随历史累积自然衰减，但低去重率说明 Agent 在尝试不同策略
        if (metrics.dedupRatio <= config.dedupSoft) {
            return {
                current: 'NORMAL',
                stalledSteps: 0,
                suspectedSinceStep: -1,
            };
        }
        // SUSPECTED → CONFIRMED：去重率超过硬阈值（直接确认）
        if (metrics.dedupRatio > config.dedupHard) {
            return {
                current: 'CONFIRMED',
                stalledSteps: state.stalledSteps + 1,
                suspectedSinceStep: state.suspectedSinceStep,
            };
        }
        // SUSPECTED → CONFIRMED：连续停滞步数达到容忍上限
        const newStalledSteps = state.stalledSteps + 1;
        if (newStalledSteps >= config.stallSteps) {
            return {
                current: 'CONFIRMED',
                stalledSteps: newStalledSteps,
                suspectedSinceStep: state.suspectedSinceStep,
            };
        }
        // 保持 SUSPECTED，递增停滞计数
        return {
            current: 'SUSPECTED',
            stalledSteps: newStalledSteps,
            suspectedSinceStep: state.suspectedSinceStep,
        };
    }
    // 不应到达此处，但安全起见返回原状态
    return state;
}
/**
 * 重置状态机到初始状态
 */
export function resetFsm() {
    return { ...INITIAL_FSM_STATE };
}
/**
 * 判断给定状态是否需要触发动作链
 */
export function shouldAct(state) {
    return state.current === 'CONFIRMED';
}
//# sourceMappingURL=fsm.js.map