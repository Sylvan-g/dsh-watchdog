/**
 * dsh-watchdog 插件入口
 *
 * 修复汇总：
 * - C4: 接通多级降级动作链（L1 nudge 注入提示, L3 调用 agent.cancel/steer）
 * - C5: 工具重试挂载到 tools/execute（而非 tools/post-execute）
 * - H2: loop-guard 返回 metrics 数据供 action-chain checkRecovery 使用
 * - M1: 移除 on 类型强转，使用正确的多参 handler 签名
 * - M3: 修复 ctx.effect 误用（返回 disposer 而非立即执行 reset）
 * - M5: context-guard 压缩提示通过 agent.steer 注入
 */

import type { WatchdogConfig, AgentRequestPayload, LlmCallConfig, SessionEvent, ContentBlock } from './sentinel/types.js'
import { extractAgent, extractEvents } from './sentinel/types.js'
import { DEFAULT_CONFIG } from './sentinel/types.js'
import { mergeConfig } from './settings.js'
import { createLoopGuard } from './guards/loop-guard.js'
import { createToolRetryGuard } from './guards/tool-retry.js'
import { createContextGuard } from './guards/context-guard.js'
import { createActionChain } from './actions/index.js'
import { logger } from './report/logger.js'

// 重新导出核心类型和函数
export type { WatchdogConfig, LoopGuardConfig, ToolRetryConfig, ContextGuardConfig, ActionsConfig } from './sentinel/types.js'
export { DEFAULT_CONFIG } from './sentinel/types.js'
export { SentinelWatch } from './sentinel/watch.js'
export { computeMetrics, actionSignature, computeInfoGain } from './sentinel/metrics.js'
export { transition, resetFsm, shouldAct, INITIAL_FSM_STATE } from './sentinel/fsm.js'
export { DiagnosticReportBuilder } from './report/diagnostic.js'
export { createLogger } from './report/logger.js'

/**
 * Cordis 插件入口
 *
 * @param ctx Cordis Context
 * @param config 用户配置（覆盖默认值）
 */
export function apply(ctx: any, config: Partial<WatchdogConfig> = {}): void {
  // 合并配置
  const fullConfig = mergeConfig(config)

  if (!fullConfig.enabled) {
    return
  }

  // 创建守卫和动作链
  const loopGuard = createLoopGuard(fullConfig)
  const toolRetryGuard = createToolRetryGuard(fullConfig)
  const contextGuard = createContextGuard(fullConfig)
  const actionChain = createActionChain(fullConfig)

  // ─── agent/request waterfall ───
  // 挂载点：{ agent, turn, step, signal } → LlmCallConfig
  ctx.on('agent/request', async (payload: AgentRequestPayload, next: () => Promise<LlmCallConfig>) => {
    // 必须 await next()，否则上游 provider/model/tools 丢失
    const seed = await next()

    if (!fullConfig.loopGuard.enabled && !fullConfig.contextGuard.enabled) {
      return seed
    }

    const events = extractEvents(payload)
    const agent = extractAgent(payload)

    // 1. loop-guard 检测
    const loopResult = await loopGuard.handleRequest(payload, async () => seed)

    // 2. context-guard 检测（修复 M5：返回压缩提示）
    const contextResult = await contextGuard.handleRequest(payload, async () => loopResult.seed ?? loopResult as any)

    // 3. 如果 context-guard 需要注入压缩提示，通过 agent.steer 注入
    if (contextResult.compressionPrompt && agent?.steer) {
      agent.steer(contextResult.compressionPrompt)
    }

    // 4. 如果 loop-guard 触发动作链（C4：接通动作链）
    if (loopResult.shouldAct && loopResult.actionLevel) {
      const actionResult = actionChain.execute(
        loopResult.diagnostic?.trigger ?? 'loop-detected',
        payload,
        contextResult.seed,
      )

      // 动作链可能返回 patch
      const patchedSeed = { ...contextResult.seed, ...actionResult.patch }

      // L1 nudge：通过 agent.steer 注入纠偏提示
      if (actionResult.nudgePrompt && agent?.steer) {
        agent.steer(actionResult.nudgePrompt)
      }

      // L3 stop：通过 agent.cancel 终止
      if (actionResult.terminated && agent?.cancel) {
        agent.cancel({ kind: 'hook', reason: 'watchdog-loop-detected' })
      }

      return patchedSeed
    }

    // 5. 检查 action-chain 纠偏恢复（使用 loop-guard 的 metrics 数据）
    if (actionChain.currentLevel === 'L1') {
      const metrics = loopResult.metrics
      if (metrics) {
        actionChain.checkRecovery(metrics)
      }
    }

    return contextResult.seed
  })

  // ─── tools/execute waterfall ───
  // 修复 C5：挂载到 tools/execute（around-dispatch），而非 tools/post-execute
  // tools/execute 的 JSDoc 明示 "Around-dispatch waterfall for timeout, retry, or metrics"
  ctx.on('tools/execute', async (exec: any, next: () => Promise<any>) => {
    // 执行工具
    const result = await next()

    if (!fullConfig.toolRetry.enabled) {
      return result
    }

    // 仅在工具失败时重试
    if (result?.isError) {
      const toolCtx = {
        name: exec?.name ?? 'unknown',
        arguments: exec?.arguments ?? {},
        callId: exec?.callId ?? '',
      }

      const decision = toolRetryGuard.handleResult(toolCtx, {
        isError: true,
        error: result.error ?? { name: 'UnknownError', code: 'UNKNOWN' },
        content: result.content,
      })

      switch (decision.kind) {
        case 'retry': {
          // 在 tools/execute 中，可以通过修改 exec.signal 控制重试
          // 指数退避等待后重新调用 next()
          if (decision.delay > 0) {
            await new Promise(resolve => setTimeout(resolve, decision.delay))
          }
          // 重新执行工具
          const retryResult = await next()
          return retryResult
        }
        case 'fallback':
        case 'readonly':
        case 'block':
          // 降级/阻断：返回原始错误结果
          return result
        case 'accept':
        default:
          return result
      }
    }

    return result
  })

  // ─── agent/request-error ───
  // context-guard 捕获 CONTEXT_WINDOW_EXCEEDED
  ctx.on('agent/request-error', async (payload: any, next: () => Promise<any>) => {
    const failure = payload?.failure
    if (failure && fullConfig.contextGuard.enabled) {
      const retryDecision = contextGuard.handleRequestError(failure)
      if (retryDecision === 'retry') {
        return { kind: 'retry' }
      }
    }
    return next()
  })

  // ─── 可逆清理：插件卸载时恢复原状（修复 M3：ctx.effect 返回 disposer） ───
  ctx.effect(() => {
    // 返回 disposer 函数，在插件卸载时执行
    return () => {
      loopGuard.reset()
      toolRetryGuard.reset()
      contextGuard.reset()
      actionChain.reset()
    }
  })

  // ─── 日志：插件启动 ───
  logger.append({
    timestamp: Date.now(),
    type: 'loop-guard:state-change',
    data: { message: 'dsh-watchdog plugin initialized', config: fullConfig },
  })
}

/**
 * 插件元信息
 */
export const name = 'dsh-watchdog'
export const inject = ['settings']
