/**
 * 诊断报告生成器
 *
 * 在检测到死循环 / 上下文溢出 / 工具失败链时，
 * 生成结构化的 DiagnosticReport 供 L3 停止动作和 web 面板消费。
 */
/** 诊断报告构建器 */
export class DiagnosticReportBuilder {
    sessionId;
    finalState = 'NORMAL';
    trigger = '';
    repeatedActions = [];
    stepTokenUsage = [];
    stalledSinceStep = -1;
    actionChain = [];
    contextGuardTriggers = [];
    toolRetryLog = [];
    constructor(sessionId) {
        this.sessionId = sessionId;
    }
    /** 设置最终状态 */
    setFinalState(state) {
        this.finalState = state;
        return this;
    }
    /** 设置触发原因 */
    setTrigger(trigger) {
        this.trigger = trigger;
        return this;
    }
    /** 从诊断快照填充 */
    applySnapshot(snapshot) {
        this.finalState = snapshot.state;
        this.trigger = snapshot.trigger;
        this.repeatedActions = snapshot.metrics.topSignatures;
        this.stalledSinceStep = Math.max(this.stalledSinceStep, snapshot.stalledSteps > 0
            ? (this.stepTokenUsage.length > 0 ? this.stepTokenUsage.length - snapshot.stalledSteps : 0)
            : -1);
        return this;
    }
    /** 设置重复动作 */
    setRepeatedActions(actions) {
        this.repeatedActions = actions;
        return this;
    }
    /** 添加 step token 使用记录 */
    addStepTokenUsage(step, inputTokens, outputTokens) {
        this.stepTokenUsage.push({ step, inputTokens, outputTokens });
        return this;
    }
    /** 设置卡死起始步 */
    setStalledSinceStep(step) {
        this.stalledSinceStep = step;
        return this;
    }
    /** 添加动作链记录 */
    addAction(level, action, result) {
        this.actionChain.push({ level, action, result, timestamp: Date.now() });
        return this;
    }
    /** 添加上下文守卫触发记录 */
    addContextGuardTrigger(type, tokenCount) {
        this.contextGuardTriggers.push({ type, tokenCount, timestamp: Date.now() });
        return this;
    }
    /** 添加工具重试记录 */
    addToolRetry(tool, attempt, result) {
        this.toolRetryLog.push({ tool, attempt, result, timestamp: Date.now() });
        return this;
    }
    /** 构建诊断报告 */
    build() {
        return {
            id: generateReportId(),
            sessionId: this.sessionId,
            timestamp: Date.now(),
            finalState: this.finalState,
            trigger: this.trigger,
            repeatedActions: this.repeatedActions,
            stepTokenUsage: this.stepTokenUsage,
            stalledSinceStep: this.stalledSinceStep,
            actionChain: this.actionChain,
            contextGuardTriggers: this.contextGuardTriggers,
            toolRetryLog: this.toolRetryLog,
        };
    }
    /** 生成人类可读的摘要 */
    buildSummary() {
        const report = this.build();
        const lines = [
            `=== dsh-watchdog 诊断报告 ===`,
            `报告 ID: ${report.id}`,
            `时间: ${new Date(report.timestamp).toISOString()}`,
            `最终状态: ${report.finalState}`,
            `触发原因: ${report.trigger}`,
            '',
        ];
        if (report.repeatedActions.length > 0) {
            lines.push('重复动作:');
            for (const action of report.repeatedActions) {
                lines.push(`  - ${action.signature}: ${action.count} 次`);
            }
            lines.push('');
        }
        if (report.stalledSinceStep >= 0) {
            lines.push(`卡死起始步: 第 ${report.stalledSinceStep} 步`);
            lines.push('');
        }
        if (report.actionChain.length > 0) {
            lines.push('执行的动作链:');
            for (const action of report.actionChain) {
                lines.push(`  [${action.level}] ${action.action} → ${action.result}`);
            }
            lines.push('');
        }
        if (report.contextGuardTriggers.length > 0) {
            lines.push('上下文守卫触发:');
            for (const trigger of report.contextGuardTriggers) {
                lines.push(`  - ${trigger.type} 阈值, token 数: ${trigger.tokenCount}`);
            }
            lines.push('');
        }
        if (report.toolRetryLog.length > 0) {
            lines.push('工具重试记录:');
            for (const retry of report.toolRetryLog) {
                lines.push(`  - ${retry.tool}: 第 ${retry.attempt} 次 → ${retry.result}`);
            }
        }
        return lines.join('\n');
    }
}
/** 生成报告 ID */
function generateReportId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `wd-${ts}-${rand}`;
}
//# sourceMappingURL=diagnostic.js.map