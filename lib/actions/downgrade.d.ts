/**
 * L2 降级动作（downgrade）
 *
 * 修改运行时配置重跑子任务：
 * - 换更小模型 / 降低 reasoningEffort
 * - 限制步数（maxTokens）
 * - 简化工具集（通过 seed 覆盖）
 */
import type { LlmCallConfig } from '../sentinel/types.js';
/** 降级结果 */
export type DowngradeResult = 'ok' | 'failed';
/** 降级配置 */
export interface DowngradeConfig {
    /** 降低推理强度 */
    reasoningEffort?: 'off' | 'high' | 'max';
    /** 限制输出 token */
    maxTokens?: number;
    /** 限制温度 */
    temperature?: number;
}
/**
 * 创建 L2 降级动作
 */
export declare function createDowngrade(): {
    apply: (seed: LlmCallConfig) => {
        seed: LlmCallConfig;
        result: DowngradeResult;
    };
    isExhausted: () => boolean;
    reset: () => void;
    readonly currentLevel: number;
    readonly applied: boolean;
};
//# sourceMappingURL=downgrade.d.ts.map