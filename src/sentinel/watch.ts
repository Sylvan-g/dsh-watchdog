/**
 * Sentinel Core: watch() 聚合函数
 *
 * 纯函数入口：读 session.events → 计算度量 → 推进状态机 → 返回决策
 * 零外部依赖，可单测。
 *
 * 三个 Guard 复用同一个 watch() 的度量结果，各自只消费自己关心的信号。
 */

import type { SessionEvent, WatchdogConfig, WatchResult, DiagnosticSnapshot, LoopState } from './types.js'
import { computeMetrics } from './metrics.js'
import { transition, INITIAL_FSM_STATE, shouldAct, type FsmState } from './fsm.js'

/**
 * watch() 的有状态封装，维护状态机跨步调用
 *
 * 每次 agent/request 触发时调用，返回当前决策结果。
 */
export class SentinelWatch {
  private fsmState: FsmState = { ...INITIAL_FSM_STATE }
  private step = 0
  private readonly config: WatchdogConfig

  constructor(config: WatchdogConfig) {
    this.config = config
  }

  /**
   * 重置状态机（新会话开始时调用）
   */
  reset(): void {
    this.fsmState = { ...INITIAL_FSM_STATE }
    this.step = 0
  }

  /**
   * 获取当前状态机状态
   */
  get state(): FsmState {
    return { ...this.fsmState }
  }

  /**
   * 每步调用：读事件历史 → 计算度量 → 推进状态机 → 返回决策
   *
   * @param events session.events 全量事件列表
   * @returns 判定结果
   */
  watch(events: readonly SessionEvent[]): WatchResult {
    this.step++

    // 如果 loopGuard 未启用，直接返回 NORMAL
    if (!this.config.loopGuard.enabled) {
      return {
        state: 'NORMAL',
        metrics: {
          dedupRatio: 0,
          infoGain: 1,
          tokenSlope: 0,
          windowSize: 0,
          topSignatures: [],
        },
        patch: {},
        shouldAct: false,
      }
    }

    // 计算进展度量
    const metrics = computeMetrics(events, this.config.loopGuard)

    // 推进状态机
    this.fsmState = transition(this.fsmState, metrics, this.config.loopGuard, this.step)

    // 构造返回结果
    const result: WatchResult = {
      state: this.fsmState.current,
      metrics,
      patch: {},
      shouldAct: shouldAct(this.fsmState),
    }

    // 根据状态决定需要注入的 patch 和动作级别
    if (this.fsmState.current === 'CONFIRMED') {
      result.actionLevel = 'nudge' // 先尝试 L1
      result.diagnostic = this.createSnapshot(metrics, 'loop-confirmed')
    } else if (this.fsmState.current === 'SUSPECTED') {
      // SUSPECTED 状态注入提醒（通过 system prompt 方式，不触发动作链）
      result.diagnostic = this.createSnapshot(metrics, 'loop-suspected')
    }

    return result
  }

  /**
   * 创建诊断快照
   */
  private createSnapshot(metrics: import('./types.js').ProgressMetrics, trigger: string): DiagnosticSnapshot {
    return {
      timestamp: Date.now(),
      state: this.fsmState.current,
      metrics,
      trigger,
      stalledSteps: this.fsmState.stalledSteps,
    }
  }
}

/**
 * 无状态版本的 watch（兼容架构文档中的纯函数签名）
 *
 * 注意：每次调用都从 NORMAL 状态开始，不维护状态机跨步。
 * 生产环境应使用 SentinelWatch 类的有状态版本。
 * 此函数主要用于单元测试和一次性判定。
 */
export function watch(events: readonly SessionEvent[], config: WatchdogConfig): WatchResult {
  const sentinel = new SentinelWatch(config)
  return sentinel.watch(events)
}
