/**
 * 多级降级动作链编排
 *
 * 检测到异常时按代价递增逐级执行：
 * L1 纠偏（nudge）→ L2 降级（downgrade）→ L3 停止（stop）
 *
 * 前一级失败自动进入下一级。
 */

import type { WatchdogConfig, AgentRequestPayload, LlmCallConfig, DiagnosticReport } from '../sentinel/types.js'
import { createNudge, type NudgeResult } from './nudge.js'
import { createDowngrade, type DowngradeResult } from './downgrade.js'
import { createStop, type StopMethod } from './stop.js'
import { logger } from '../report/logger.js'

/** 动作链当前级别 */
export type ActionLevel = 'none' | 'L1' | 'L2' | 'L3'

/** 动作链执行结果 */
export interface ActionChainResult {
  /** 当前级别 */
  level: ActionLevel
  /** 需要注入到 seed 的补丁 */
  patch: Record<string, unknown>
  /** 是否已终止 */
  terminated: boolean
  /** 诊断报告（仅 L3 终止时生成） */
  report?: DiagnosticReport
  /** 纠偏提示（仅 L1 时有值） */
  nudgePrompt?: string
}

/**
 * 创建动作链编排器
 */
export function createActionChain(config: WatchdogConfig) {
  const nudge = createNudge(config)
  const downgrade = createDowngrade()
  const stop = createStop()
  let currentLevel: ActionLevel = 'none'

  /**
   * 执行动作链
   *
   * @param trigger 触发原因
   * @param payload agent/request payload
   * @param seed 当前 LlmCallConfig
   * @returns 动作链执行结果
   */
  function execute(
    trigger: string,
    payload: AgentRequestPayload,
    seed: LlmCallConfig,
  ): ActionChainResult {
    const baseResult: ActionChainResult = {
      level: currentLevel,
      patch: {},
      terminated: false,
    }

    // 如果已到 L3 且已停止，不再执行
    if (stop.stopped) {
      return { ...baseResult, level: 'L3', terminated: true }
    }

    // L1 纠偏
    if (currentLevel === 'none' || currentLevel === 'L1') {
      currentLevel = 'L1'
      const prompt = nudge.inject(trigger)
      logger.logAction(undefined, 'nudge', 'injected')
      return {
        ...baseResult,
        level: 'L1',
        nudgePrompt: prompt,
      }
    }

    // L2 降级
    if (currentLevel === 'L2' || nudge.nudged) {
      currentLevel = 'L2'
      const { seed: patched, result } = downgrade.apply(seed)
      if (result === 'ok') {
        return {
          ...baseResult,
          level: 'L2',
          patch: {
            ...(patched.reasoningEffort && { reasoningEffort: patched.reasoningEffort }),
            ...(patched.maxTokens && { maxTokens: patched.maxTokens }),
            ...(patched.temperature && { temperature: patched.temperature }),
          },
        }
      }
      // L2 用尽，进入 L3
      currentLevel = 'L3'
    }

    // L3 停止
    if (currentLevel === 'L3') {
      const agent = payload.agent as import('../sentinel/types.js').AgentLike | undefined
      if (agent?.cancel) {
        const { report } = stop.executeHardStop(agent.cancel, undefined, trigger)
        return {
          ...baseResult,
          level: 'L3',
          terminated: true,
          report,
        }
      } else if (agent?.steer) {
        const { report, message } = stop.executeSoftStop(agent.steer, undefined, trigger)
        return {
          ...baseResult,
          level: 'L3',
          terminated: true,
          report,
          nudgePrompt: message,
        }
      } else {
        // 无法停止，记录日志
        logger.logAction(undefined, 'stop', 'failed: no cancel or steer available')
        return {
          ...baseResult,
          level: 'L3',
          terminated: false,
        }
      }
    }

    return baseResult
  }

  /**
   * 检查 L1 纠偏后是否恢复
   * 在每次 agent/request 时调用
   */
  function checkRecovery(metrics: import('../sentinel/types.js').ProgressMetrics): void {
    if (currentLevel !== 'L1') return

    const result = nudge.checkRecovery(metrics)
    if (result === 'recovered') {
      currentLevel = 'none'
    } else if (result === 'failed') {
      currentLevel = 'L2'
    }
  }

  /**
   * 重置
   */
  function reset(): void {
    nudge.reset()
    downgrade.reset()
    stop.reset()
    currentLevel = 'none'
  }

  return {
    execute,
    checkRecovery,
    reset,
    get currentLevel() { return currentLevel },
    get nudge() { return nudge },
    get downgrade() { return downgrade },
    get stop() { return stop },
  }
}
