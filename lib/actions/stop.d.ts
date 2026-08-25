/**
 * L3 停止动作（stop）
 *
 * 硬停止为主、软停止为辅：
 * 1. 硬停止：agent.cancel({ kind: 'hook', reason: 'watchdog-loop-detected' })
 * 2. 软停止：agent.steer(msg) 注入"请停止并总结"消息
 *
 * 停止后生成诊断报告。
 */
import type { DiagnosticReport } from '../sentinel/types.js';
import { DiagnosticReportBuilder } from '../report/diagnostic.js';
/** 停止方式 */
export type StopMethod = 'hard' | 'soft';
/** 停止结果 */
export interface StopResult {
    method: StopMethod;
    report: DiagnosticReport;
}
/**
 * 创建 L3 停止动作
 */
export declare function createStop(): {
    executeHardStop: (agentCancel: (opts: {
        kind: string;
        reason: string;
    }) => void, sessionId?: string, trigger?: string) => StopResult;
    executeSoftStop: (agentSteer: (msg: string) => void, sessionId?: string, trigger?: string) => StopResult & {
        message: string;
    };
    getReportBuilder: () => DiagnosticReportBuilder | null;
    reset: () => void;
    readonly stopped: boolean;
};
//# sourceMappingURL=stop.d.ts.map