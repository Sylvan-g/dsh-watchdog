/**
 * L3 停止动作（stop）
 *
 * 硬停止为主、软停止为辅：
 * 1. 硬停止：agent.cancel({ kind: 'hook', reason: 'watchdog-loop-detected' })
 * 2. 软停止：agent.steer(msg) 注入"请停止并总结"消息
 *
 * 停止后生成诊断报告。
 */

import type { DiagnosticReport } from '../sentinel/types.js'
import { DiagnosticReportBuilder } from '../report/diagnostic.js'
import { logger } from '../report/logger.js'

/** 停止方式 */
export type StopMethod = 'hard' | 'soft'

/** 停止结果 */
export interface StopResult {
  method: StopMethod
  report: DiagnosticReport
}

/** 软停止提示 */
const SOFT_STOP_PROMPT = `[watchdog] 检测到持续无进展，任务已被终止。请停止当前操作，总结已完成的进展和遇到的问题，并给出下一步建议。`

/**
 * 创建 L3 停止动作
 */
export function createStop() {
  let stopped = false
  let reportBuilder: DiagnosticReportBuilder | null = null

  /**
   * 执行硬停止
   *
   * @param agentCancel agent.cancel 函数引用
   * @param sessionId 会话 ID
   * @param trigger 触发原因
   * @returns 停止结果
   */
  function executeHardStop(
    agentCancel: (opts: { kind: string; reason: string }) => void,
    sessionId?: string,
    trigger = 'watchdog-loop-detected',
  ): StopResult {
    reportBuilder = new DiagnosticReportBuilder(sessionId)
      .setFinalState('CONFIRMED')
      .setTrigger(trigger)
      .addAction('L3', 'hard-stop', 'executed')

    // 执行硬停止
    try {
      agentCancel({ kind: 'hook', reason: trigger })
      logger.logAction(undefined, 'stop', 'hard-stop-executed')
    } catch (err) {
      logger.logAction(undefined, 'stop', `hard-stop-failed: ${err}`)
    }

    stopped = true
    const report = reportBuilder.build()
    return { method: 'hard', report }
  }

  /**
   * 执行软停止
   *
   * @param agentSteer agent.steer 函数引用
   * @param sessionId 会话 ID
   * @param trigger 触发原因
   * @returns 停止结果 + 注入的消息
   */
  function executeSoftStop(
    agentSteer: (msg: string) => void,
    sessionId?: string,
    trigger = 'watchdog-loop-detected',
  ): StopResult & { message: string } {
    reportBuilder = new DiagnosticReportBuilder(sessionId)
      .setFinalState('CONFIRMED')
      .setTrigger(trigger)
      .addAction('L3', 'soft-stop', 'executed')

    // 执行软停止
    try {
      agentSteer(SOFT_STOP_PROMPT)
      logger.logAction(undefined, 'stop', 'soft-stop-injected')
    } catch (err) {
      logger.logAction(undefined, 'stop', `soft-stop-failed: ${err}`)
    }

    stopped = true
    const report = reportBuilder.build()
    return { method: 'soft', report, message: SOFT_STOP_PROMPT }
  }

  /**
   * 获取诊断报告构建器（供外部填充更多数据）
   */
  function getReportBuilder(): DiagnosticReportBuilder | null {
    return reportBuilder
  }

  /**
   * 重置
   */
  function reset(): void {
    stopped = false
    reportBuilder = null
  }

  return {
    executeHardStop,
    executeSoftStop,
    getReportBuilder,
    reset,
    get stopped() { return stopped },
  }
}
