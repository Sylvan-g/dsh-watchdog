/**
 * 死循环 / 无进展检测守卫（loop-guard）
 *
 * 挂载 agent/request waterfall，每步读取 session.events，
 * 通过 SentinelWatch 计算进展度量、推进状态机，
 * 在 CONFIRMED 时触发 Actions 动作链。
 *
 * 修复 H2：handleRequest 返回 LoopGuardResult（含 metrics），供 index.ts 使用
 */
import { extractEvents } from '../sentinel/types.js';
import { SentinelWatch } from '../sentinel/watch.js';
import { logger } from '../report/logger.js';
/**
 * 创建 loop-guard
 */
export function createLoopGuard(config) {
    const sentinel = new SentinelWatch(config);
    const state = {
        nudged: false,
        downgraded: false,
        stopped: false,
    };
    /**
     * 处理 agent/request 事件
     */
    async function handleRequest(payload, next) {
        const seed = await next();
        if (!config.loopGuard.enabled) {
            return { seed, metrics: null, state: 'NORMAL', shouldAct: false };
        }
        const events = extractEvents(payload);
        const result = sentinel.watch(events);
        // 记录状态变化日志
        if (result.diagnostic) {
            if (result.state === 'CONFIRMED') {
                logger.logConfirmed(undefined, result.diagnostic);
            }
        }
        // 构造返回结果（包含 metrics 数据）
        const guardResult = {
            seed,
            metrics: result.metrics,
            state: result.state,
            shouldAct: result.shouldAct,
            actionLevel: result.actionLevel,
            diagnostic: result.diagnostic,
        };
        // 如果需要降级 patch（L2 downgrade）
        if (result.shouldAct && result.actionLevel === 'nudge') {
            // L1/L2/L3 由 index.ts 中的 actionChain 处理
            // 这里只在 L2 时修改 seed
            if (state.nudged && !state.downgraded) {
                state.downgraded = true;
                logger.logAction(undefined, 'downgrade', 'applied');
                guardResult.seed = {
                    ...seed,
                    maxTokens: 2048,
                    reasoningEffort: 'off',
                };
            }
            else if (!state.nudged) {
                state.nudged = true;
            }
        }
        return guardResult;
    }
    /**
     * 重置守卫状态（新会话开始时调用）
     */
    function reset() {
        sentinel.reset();
        state.nudged = false;
        state.downgraded = false;
        state.stopped = false;
    }
    return {
        handleRequest,
        reset,
        get state() { return { ...state }; },
        get sentinel() { return sentinel; },
        get metrics() { return sentinel.watch([]).metrics; },
    };
}
//# sourceMappingURL=loop-guard.js.map