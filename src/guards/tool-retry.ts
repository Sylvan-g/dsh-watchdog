/**
 * 工具失败重试与降级守卫（tool-retry）
 *
 * 挂载 tools/post-execute 事件，在工具调用失败时：
 * 1. 重试：指数退避重试同工具（可配最大次数）
 * 2. 换备用工具：若声明了等价备用工具，切换
 * 3. 只读兜底：降级为只读查询类工具
 * 4. 交还用户：仍失败则终止该工具链，交还用户决策
 *
 * 基于 dsh 架构文档 §13.2，工具失败走 ctx.tools 三个事件：
 * - tools/pre-execute：拦截决策
 * - tools/execute：实际执行（可包超时/重试）
 * - tools/post-execute：结果处理
 */

import type { WatchdogConfig, ToolExecutionContext, ToolExecutionResult } from '../sentinel/types.js'
import { logger } from '../report/logger.js'
import { DiagnosticReportBuilder } from '../report/diagnostic.js'

/** 工具重试状态跟踪 */
export interface ToolRetryState {
  /** 每个工具的当前重试次数 */
  retryCount: Map<string, number>
  /** 备用工具映射 */
  fallbackMap: Map<string, string[]>
  /** 降级链当前层级 */
  degradationLevel: Map<string, 'retry' | 'fallback' | 'readonly' | 'surrender'>
}

/**
 * 创建 tool-retry 守卫
 */
export function createToolRetryGuard(config: WatchdogConfig) {
  const state: ToolRetryState = {
    retryCount: new Map(),
    fallbackMap: new Map(),
    degradationLevel: new Map(),
  }

  const maxRetries = config.toolRetry.maxRetries
  const backoffMs = config.toolRetry.backoffMs

  /**
   * 注册备用工具映射
   * 允许用户配置：工具 A 失败后可以尝试工具 B、C
   */
  function registerFallback(toolName: string, fallbacks: string[]): void {
    state.fallbackMap.set(toolName, fallbacks)
  }

  /**
   * 处理工具执行结果
   * 返回决策：是否重试、是否降级、是否交还用户
   */
  function handleResult(
    ctx: ToolExecutionContext,
    result: ToolExecutionResult,
  ): ToolRetryDecision {
    if (!result.isError) {
      // 成功则重置重试计数
      state.retryCount.delete(ctx.name)
      state.degradationLevel.delete(ctx.name)
      return { kind: 'accept', content: typeof result.content === 'string' ? result.content : undefined }
    }

    if (!config.toolRetry.enabled) {
      return { kind: 'block', feedback: `Tool ${ctx.name} failed`, surrender: true }
    }

    const currentRetries = state.retryCount.get(ctx.name) ?? 0
    const currentLevel = state.degradationLevel.get(ctx.name) ?? 'retry'

    // 根据当前降级层级处理
    switch (currentLevel) {
      case 'retry': {
        if (currentRetries < maxRetries) {
          const nextRetry = currentRetries + 1
          state.retryCount.set(ctx.name, nextRetry)
          const delay = backoffMs[Math.min(nextRetry - 1, backoffMs.length - 1)] ?? backoffMs[backoffMs.length - 1]

          logger.logToolRetry(undefined, ctx.name, nextRetry, 'retrying', delay)

          return {
            kind: 'retry',
            delay,
            attempt: nextRetry,
          }
        }
        // 重试耗尽，进入降级
        state.degradationLevel.set(ctx.name, 'fallback')
        state.retryCount.set(ctx.name, 0)
        return handleFallback(ctx, result)
      }

      case 'fallback': {
        return handleFallback(ctx, result)
      }

      case 'readonly': {
        // 只读兜底也失败，交还用户
        state.degradationLevel.set(ctx.name, 'surrender')
        logger.logToolRetry(undefined, ctx.name, currentRetries, 'failed')
        return {
          kind: 'block',
          feedback: `Tool ${ctx.name} failed after all retries and fallbacks. Error: ${result.error?.name ?? result.error?.code ?? 'unknown'}`,
          surrender: true,
        }
      }

      case 'surrender': {
        return {
          kind: 'block',
          feedback: `Tool ${ctx.name} has been surrendered to user decision.`,
          surrender: true,
        }
      }
    }
  }

  /**
   * 处理降级到备用工具
   */
  function handleFallback(ctx: ToolExecutionContext, result: ToolExecutionResult): ToolRetryDecision {
    const fallbacks = state.fallbackMap.get(ctx.name)

    if (fallbacks && fallbacks.length > 0) {
      const fallbackTool = fallbacks[0]
      logger.logToolRetry(undefined, ctx.name, 0, 'fallback')
      return {
        kind: 'fallback',
        fallbackTool,
        reason: `Switching from ${ctx.name} to fallback ${fallbackTool}`,
      }
    }

    // 没有备用工具，尝试只读兜底
    state.degradationLevel.set(ctx.name, 'readonly')
    logger.logToolRetry(undefined, ctx.name, 0, 'readonly')
    return {
      kind: 'readonly',
      reason: `No fallback for ${ctx.name}, degrading to read-only mode`,
    }
  }

  /**
   * 计算退避延迟
   */
  function getBackoffDelay(retryCount: number): number {
    const idx = Math.min(retryCount, backoffMs.length - 1)
    return backoffMs[idx] ?? backoffMs[backoffMs.length - 1] ?? 1000
  }

  /**
   * 重置状态
   */
  function reset(): void {
    state.retryCount.clear()
    state.degradationLevel.clear()
  }

  return {
    handleResult,
    registerFallback,
    getBackoffDelay,
    reset,
    get state() {
      return {
        retryCount: new Map(state.retryCount),
        fallbackMap: new Map(state.fallbackMap),
        degradationLevel: new Map(state.degradationLevel),
      }
    },
  }
}

/** 工具重试决策 */
export type ToolRetryDecision =
  | { kind: 'accept'; content?: string }
  | { kind: 'retry'; delay: number; attempt: number }
  | { kind: 'fallback'; fallbackTool: string; reason: string }
  | { kind: 'readonly'; reason: string }
  | { kind: 'block'; feedback: string; surrender: boolean }
