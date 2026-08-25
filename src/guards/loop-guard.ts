/**
 * 死循环 / 无进展检测守卫（loop-guard）
 *
 * 挂载 agent/request waterfall，每步读取 session.events，
 * 通过 SentinelWatch 计算进展度量、推进状态机，
 * 在 CONFIRMED 时触发 Actions 动作链。
 *
 * 修复 H2：handleRequest 返回 LoopGuardResult（含 metrics），供 index.ts 使用
 */

import type { WatchdogConfig, AgentRequestPayload, LlmCallConfig, ProgressMetrics } from '../sentinel/types.js'
import { extractEvents, extractAgent } from '../sentinel/types.js'
import { SentinelWatch } from '../sentinel/watch.js'
import { logger } from '../report/logger.js'

/**
 * loop-guard 守卫的内部状态
 */
export interface LoopGuardState {
  /** 是否已触发过 L1 纠偏 */
  nudged: boolean
  /** 是否已触发过 L2 降级 */
  downgraded: boolean
  /** 是否已触发过 L3 停止 */
  stopped: boolean
}

/**
 * loop-guard handleRequest 返回结果
 */
export interface LoopGuardResult {
  /** 修改后的 seed */
  seed: LlmCallConfig
  /** 当前状态机的度量数据（供 action-chain checkRecovery 使用） */
  metrics: ProgressMetrics | null
  /** 当前状态 */
  state: string
  /** 是否需要触发动作链 */
  shouldAct: boolean
  /** 动作级别 */
  actionLevel?: 'nudge' | 'downgrade' | 'stop'
  /** 诊断快照 */
  diagnostic?: any
}

/**
 * 创建 loop-guard
 */
export function createLoopGuard(config: WatchdogConfig) {
  const sentinel = new SentinelWatch(config)
  const state: LoopGuardState = {
    nudged: false,
    downgraded: false,
    stopped: false,
  }

  /**
   * 处理 agent/request 事件
   */
  async function handleRequest(
    payload: AgentRequestPayload,
    next: () => Promise<LlmCallConfig>,
  ): Promise<LoopGuardResult> {
    const seed = await next()

    if (!config.loopGuard.enabled) {
      return { seed, metrics: null, state: 'NORMAL', shouldAct: false }
    }

    const events = extractEvents(payload)
    const result = sentinel.watch(events)

    // 记录状态变化日志
    if (result.diagnostic) {
      if (result.state === 'CONFIRMED') {
        logger.logConfirmed(undefined, result.diagnostic)
      }
    }

    // 构造返回结果（包含 metrics 数据）
    const guardResult: LoopGuardResult = {
      seed,
      metrics: result.metrics,
      state: result.state,
      shouldAct: result.shouldAct,
      actionLevel: result.actionLevel,
      diagnostic: result.diagnostic,
    }

    // 如果需要降级 patch（L2 downgrade）
    if (result.shouldAct && result.actionLevel === 'nudge') {
      // L1/L2/L3 由 index.ts 中的 actionChain 处理
      // 这里只在 L2 时修改 seed
      if (state.nudged && !state.downgraded) {
        state.downgraded = true
        logger.logAction(undefined, 'downgrade', 'applied')
        guardResult.seed = {
          ...seed,
          maxTokens: 2048,
          reasoningEffort: 'off' as const,
        }
      } else if (!state.nudged) {
        state.nudged = true
      }
    }

    return guardResult
  }

  /**
   * 重置守卫状态（新会话开始时调用）
   */
  function reset(): void {
    sentinel.reset()
    state.nudged = false
    state.downgraded = false
    state.stopped = false
  }

  return {
    handleRequest,
    reset,
    get state() { return { ...state } },
    get sentinel() { return sentinel },
    get metrics() { return sentinel.watch([] as any).metrics },
  }
}
