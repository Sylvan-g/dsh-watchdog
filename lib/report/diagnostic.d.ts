/**
 * 诊断报告生成器
 *
 * 在检测到死循环 / 上下文溢出 / 工具失败链时，
 * 生成结构化的 DiagnosticReport 供 L3 停止动作和 web 面板消费。
 */
import type { DiagnosticReport, DiagnosticSnapshot, LoopState } from '../sentinel/types.js';
/** 诊断报告构建器 */
export declare class DiagnosticReportBuilder {
    private readonly sessionId?;
    private finalState;
    private trigger;
    private repeatedActions;
    private stepTokenUsage;
    private stalledSinceStep;
    private actionChain;
    private contextGuardTriggers;
    private toolRetryLog;
    constructor(sessionId?: string);
    /** 设置最终状态 */
    setFinalState(state: LoopState): this;
    /** 设置触发原因 */
    setTrigger(trigger: string): this;
    /** 从诊断快照填充 */
    applySnapshot(snapshot: DiagnosticSnapshot): this;
    /** 设置重复动作 */
    setRepeatedActions(actions: Array<{
        signature: string;
        count: number;
    }>): this;
    /** 添加 step token 使用记录 */
    addStepTokenUsage(step: number, inputTokens: number, outputTokens: number): this;
    /** 设置卡死起始步 */
    setStalledSinceStep(step: number): this;
    /** 添加动作链记录 */
    addAction(level: 'L1' | 'L2' | 'L3', action: string, result: string): this;
    /** 添加上下文守卫触发记录 */
    addContextGuardTrigger(type: 'soft' | 'hard', tokenCount: number): this;
    /** 添加工具重试记录 */
    addToolRetry(tool: string, attempt: number, result: 'success' | 'failed'): this;
    /** 构建诊断报告 */
    build(): DiagnosticReport;
    /** 生成人类可读的摘要 */
    buildSummary(): string;
}
//# sourceMappingURL=diagnostic.d.ts.map