/**
 * L1 纠偏动作（nudge）
 *
 * 通过 agent/request waterfall 注入纠偏提示，
 * 让模型自我修正行为。观察 N 步是否恢复。
 */

import type { WatchdogConfig, ProgressMetrics } from '../sentinel/types.js'
import { logger } from '../report/logger.js'

/** 纠偏提示模板 */
const NUDGE_PROMPTS = {
  'loop-detected': `[watchdog] 检测到可能的死循环：你正在重复执行相同的操作而没有取得进展。请回顾之前的步骤，尝试不同的方法或换一个思路。如果当前方法行不通，请考虑：1) 检查是否有遗漏的错误信息 2) 尝试简化问题 3) 换用不同的工具或策略`,
  'context-overflow': `[watchdog] 上下文接近窗口上限。请对历史对话进行摘要压缩，保留关键信息，删除冗余内容。`,
  'default': `[watchdog] 检测到异常行为模式。请审视当前策略，必要时调整方法。`,
}

/** 纠偏结果 */
export type NudgeResult = 'recovered' | 'failed'

/**
 * 创建 L1 纠偏动作
 */
export function createNudge(config: WatchdogConfig) {
  let stepsSinceNudge = 0
  let nudged = false
  const nudgeSteps = config.actions.nudgeSteps

  /**
   * 注入纠偏提示
   *
   * @param trigger 触发原因
   * @returns 纠偏提示文本（需由调用方注入到 prompt）
   */
  function inject(trigger: string): string {
    const prompt = NUDGE_PROMPTS[trigger as keyof typeof NUDGE_PROMPTS] ?? NUDGE_PROMPTS['default']
    nudged = true
    stepsSinceNudge = 0
    logger.logAction(undefined, 'nudge', 'injected')
    return prompt
  }

  /**
   * 检查纠偏后是否恢复
   *
   * @param metrics 当前度量
   * @returns 是否仍在观察期 / 恢复 / 失败
   */
  function checkRecovery(metrics: ProgressMetrics): 'observing' | NudgeResult {
    if (!nudged) return 'recovered'

    stepsSinceNudge++

    // 观察期内信息增量恢复 → 纠偏成功
    if (metrics.infoGain >= config.loopGuard.infoGain && metrics.dedupRatio <= config.loopGuard.dedupSoft) {
      nudged = false
      stepsSinceNudge = 0
      logger.logAction(undefined, 'nudge', 'recovered')
      return 'recovered'
    }

    // 观察期结束仍未恢复 → 纠偏失败
    if (stepsSinceNudge >= nudgeSteps) {
      logger.logAction(undefined, 'nudge', 'failed')
      return 'failed'
    }

    return 'observing'
  }

  /**
   * 重置
   */
  function reset(): void {
    stepsSinceNudge = 0
    nudged = false
  }

  return {
    inject,
    checkRecovery,
    reset,
    get nudged() { return nudged },
    get stepsSinceNudge() { return stepsSinceNudge },
  }
}
