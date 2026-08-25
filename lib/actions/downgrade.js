/**
 * L2 降级动作（downgrade）
 *
 * 修改运行时配置重跑子任务：
 * - 换更小模型 / 降低 reasoningEffort
 * - 限制步数（maxTokens）
 * - 简化工具集（通过 seed 覆盖）
 */
import { logger } from '../report/logger.js';
/** 降级预设 */
const DOWNGRADE_PRESETS = [
    { reasoningEffort: 'off', maxTokens: 2048 },
    { reasoningEffort: 'off', maxTokens: 1024, temperature: 0.3 },
];
/**
 * 创建 L2 降级动作
 */
export function createDowngrade() {
    let currentLevel = 0;
    let applied = false;
    /**
     * 应用降级配置
     *
     * @param seed 当前 LlmCallConfig
     * @returns 修改后的 seed
     */
    function apply(seed) {
        if (currentLevel >= DOWNGRADE_PRESETS.length) {
            logger.logAction(undefined, 'downgrade', 'failed: no more presets');
            return { seed, result: 'failed' };
        }
        const preset = DOWNGRADE_PRESETS[currentLevel];
        const patched = {
            ...seed,
            ...(preset.reasoningEffort !== undefined && { reasoningEffort: preset.reasoningEffort }),
            ...(preset.maxTokens !== undefined && { maxTokens: preset.maxTokens }),
            ...(preset.temperature !== undefined && { temperature: preset.temperature }),
        };
        currentLevel++;
        applied = true;
        logger.logAction(undefined, 'downgrade', `applied preset ${currentLevel}`);
        return { seed: patched, result: 'ok' };
    }
    /**
     * 检查降级是否已用尽
     */
    function isExhausted() {
        return currentLevel >= DOWNGRADE_PRESETS.length;
    }
    /**
     * 重置
     */
    function reset() {
        currentLevel = 0;
        applied = false;
    }
    return {
        apply,
        isExhausted,
        reset,
        get currentLevel() { return currentLevel; },
        get applied() { return applied; },
    };
}
//# sourceMappingURL=downgrade.js.map