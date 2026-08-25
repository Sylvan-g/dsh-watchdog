/**
 * dsh-watchdog 插件入口
 *
 * 修复汇总：
 * - C4: 接通多级降级动作链（L1 nudge 注入提示, L3 调用 agent.cancel/steer）
 * - C5: 工具重试挂载到 tools/execute（而非 tools/post-execute）
 * - H2: loop-guard 返回 metrics 数据供 action-chain checkRecovery 使用
 * - M1: 移除 on 类型强转，使用正确的多参 handler 签名
 * - M3: 修复 ctx.effect 误用（返回 disposer 而非立即执行 reset）
 * - M5: context-guard 压缩提示通过 agent.steer 注入
 */
import type { WatchdogConfig } from './sentinel/types.js';
export type { WatchdogConfig, LoopGuardConfig, ToolRetryConfig, ContextGuardConfig, ActionsConfig } from './sentinel/types.js';
export { DEFAULT_CONFIG } from './sentinel/types.js';
export { SentinelWatch } from './sentinel/watch.js';
export { computeMetrics, actionSignature, computeInfoGain } from './sentinel/metrics.js';
export { transition, resetFsm, shouldAct, INITIAL_FSM_STATE } from './sentinel/fsm.js';
export { DiagnosticReportBuilder } from './report/diagnostic.js';
export { createLogger } from './report/logger.js';
/**
 * Cordis 插件入口
 *
 * @param ctx Cordis Context
 * @param config 用户配置（覆盖默认值）
 */
export declare function apply(ctx: any, config?: Partial<WatchdogConfig>): void;
/**
 * 插件元信息
 */
export declare const name = "dsh-watchdog";
export declare const inject: string[];
//# sourceMappingURL=index.d.ts.map