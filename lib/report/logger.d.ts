/**
 * JSONL 结构化日志
 *
 * 将守卫事件追加写入 JSONL 文件（~/.dsh/watchdog/events.jsonl），
 * 作为 web 面板的数据源。
 *
 * 修复：
 * - C2: 使用 createRequire 替代 ESM 中的 require，兼容 Node ESM 运行时
 * - M4: 使用 USERPROFILE（Windows）或 HOME（Unix）获取主目录
 * - M2: logToolRetry result 参数扩展为支持重试/降级状态
 */
import type { LoopState, DiagnosticSnapshot } from '../sentinel/types.js';
/** 日志事件类型 */
export type LogEventType = 'loop-guard:state-change' | 'loop-guard:confirmed' | 'tool-retry:attempt' | 'tool-retry:exhausted' | 'tool-retry:fallback' | 'tool-retry:readonly' | 'context-guard:soft-threshold' | 'context-guard:hard-threshold' | 'action:nudge' | 'action:downgrade' | 'action:stop';
/** 日志条目 */
export interface LogEntry {
    timestamp: number;
    sessionId?: string;
    type: LogEventType;
    data: Record<string, unknown>;
}
/**
 * 创建 JSONL 日志写入器
 *
 * @param filePath 日志文件路径，默认 ~/.dsh/watchdog/events.jsonl
 * @returns 写入函数
 */
export declare function createLogger(filePath?: string): {
    append: (entry: LogEntry) => void;
    logStateChange: (sessionId: string | undefined, fromState: LoopState, toState: LoopState, snapshot: DiagnosticSnapshot) => void;
    logConfirmed: (sessionId: string | undefined, snapshot: DiagnosticSnapshot) => void;
    logToolRetry: (sessionId: string | undefined, tool: string, attempt: number, result: "success" | "failed" | "retrying" | "fallback" | "readonly", backoffMs?: number) => void;
    logContextGuard: (sessionId: string | undefined, threshold: "soft" | "hard", tokenCount: number) => void;
    logAction: (sessionId: string | undefined, level: "nudge" | "downgrade" | "stop", result: string) => void;
};
/** 默认日志写入器 */
export declare const logger: {
    append: (entry: LogEntry) => void;
    logStateChange: (sessionId: string | undefined, fromState: LoopState, toState: LoopState, snapshot: DiagnosticSnapshot) => void;
    logConfirmed: (sessionId: string | undefined, snapshot: DiagnosticSnapshot) => void;
    logToolRetry: (sessionId: string | undefined, tool: string, attempt: number, result: "success" | "failed" | "retrying" | "fallback" | "readonly", backoffMs?: number) => void;
    logContextGuard: (sessionId: string | undefined, threshold: "soft" | "hard", tokenCount: number) => void;
    logAction: (sessionId: string | undefined, level: "nudge" | "downgrade" | "stop", result: string) => void;
};
//# sourceMappingURL=logger.d.ts.map