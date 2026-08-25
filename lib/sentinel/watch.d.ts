/**
 * Sentinel Core: watch() 聚合函数
 *
 * 纯函数入口：读 session.events → 计算度量 → 推进状态机 → 返回决策
 * 零外部依赖，可单测。
 *
 * 三个 Guard 复用同一个 watch() 的度量结果，各自只消费自己关心的信号。
 */
import type { SessionEvent, WatchdogConfig, WatchResult } from './types.js';
import { type FsmState } from './fsm.js';
/**
 * watch() 的有状态封装，维护状态机跨步调用
 *
 * 每次 agent/request 触发时调用，返回当前决策结果。
 */
export declare class SentinelWatch {
    private fsmState;
    private step;
    private readonly config;
    constructor(config: WatchdogConfig);
    /**
     * 重置状态机（新会话开始时调用）
     */
    reset(): void;
    /**
     * 获取当前状态机状态
     */
    get state(): FsmState;
    /**
     * 每步调用：读事件历史 → 计算度量 → 推进状态机 → 返回决策
     *
     * @param events session.events 全量事件列表
     * @returns 判定结果
     */
    watch(events: readonly SessionEvent[]): WatchResult;
    /**
     * 创建诊断快照
     */
    private createSnapshot;
}
/**
 * 无状态版本的 watch（兼容架构文档中的纯函数签名）
 *
 * 注意：每次调用都从 NORMAL 状态开始，不维护状态机跨步。
 * 生产环境应使用 SentinelWatch 类的有状态版本。
 * 此函数主要用于单元测试和一次性判定。
 */
export declare function watch(events: readonly SessionEvent[], config: WatchdogConfig): WatchResult;
//# sourceMappingURL=watch.d.ts.map