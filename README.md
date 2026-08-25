# dsh-watchdog

<div align="center">

[![CI](https://github.com/Sylvan-g/dsh-watchdog/actions/workflows/ci.yml/badge.svg)](https://github.com/Sylvan-g/dsh-watchdog/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/Sylvan-g/dsh-watchdog)](https://github.com/Sylvan-g/dsh-watchdog/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/Sylvan-g/dsh-watchdog)](https://github.com/Sylvan-g/dsh-watchdog/releases)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

</div>

> 一个运行在 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai) 内的 **Agent 运行可靠性守卫插件**。
> 版本：v0.2.0 · License：MIT
> 本文档整合了原 `docs/PRD.md`（需求）与 `docs/ARCHITECTURE.md`（架构），并反映 v0.2.0 实际实现状态。

---

## 目录

- [1. 项目背景与定位](#1-项目背景与定位)
- [2. 目标用户与使用场景](#2-目标用户与使用场景)
- [3. 核心能力](#3-核心能力)
- [4. 快速开始](#4-快速开始)
- [5. 功能详解](#5-功能详解)
- [6. 总体架构](#6-总体架构)
- [7. 与 dsh / Cordis 的集成](#7-与-dsh--cordis-的集成)
- [8. 核心算法：死循环检测状态机](#8-核心算法死循环检测状态机)
- [9. 多级降级动作链](#9-多级降级动作链)
- [10. 数据流时序](#10-数据流时序)
- [11. 配置设计](#11-配置设计)
- [12. 可观测性](#12-可观测性)
- [13. 目录结构](#13-目录结构)
- [14. 技术栈与依赖](#14-技术栈与依赖)
- [15. API 交叉验证结果](#15-api-交叉验证结果)
- [16. 验证方法](#16-验证方法)
- [17. 范围边界](#17-范围边界)
- [18. 里程碑](#18-里程碑)
- [19. 风险与依赖](#19-风险与依赖)
- [20. 变更日志](#20-变更日志)

---

## 1. 项目背景与定位

### 1.1 背景

DeepSeek Harness（CLI 入口 `dsh`）是 DeepSeek 开源的 Agent 运行时框架，核心宣言是 **"一切皆插件"**——模型适配器、工具集、会话存储、沙箱、Agent 主循环全部可被替换。它运行在自研元框架 **Cordis** 上，提供可逆效果、类型化事件、服务注入等能力。

Agent 在跑长任务时普遍存在三类可靠性问题：

1. **死循环 / 无进展**：Agent 连续多步重复同一动作、工具反复报错、烧 token 却无有效产出。
2. **工具调用脆弱**：单次工具失败直接让任务中断，缺乏重试与降级。
3. **上下文膨胀**：轨迹越滚越大，超出上下文窗口导致遗忘或幻觉。

现有生态（`awesome-dsh-plugins` 等）已覆盖 MCP 桥接、插件市场、Skill 管理等方向，但**针对"运行可靠性"的守卫类插件仍是空白**。dsh 独有的 `agent/request waterfall`、`ctx.slots` 扩展点，恰好能实现对 Agent 运行过程的精细干预。

### 1.2 定位

`dsh-watchdog` 是 dsh 的 **可靠性守卫层**，通过监听与拦截 Agent 运行过程，自动检测死循环、恢复工具失败、遏制上下文膨胀，并在必要时执行多级降级，最终输出可审计的诊断报告与可视化面板。

### 1.3 差异化价值

- **不是又一个工具/Skill 插件**：它干预的是 Agent 的"运行过程"本身，而非提供额外能力。
- **利用 dsh 独有机制**：可替换主循环、可拦截 request、可逆效果——做成 Claude Code 生态无法复刻的东西。
- **与官方 guard 差异化**：官方 `guard/*` 包（`repeat-tool-reminder`、`timeout-policy`）均单点、无状态、被动——不跨指标、不降级、不停止；watchdog 做**跨指标联合三态 FSM + L1/L2/L3 多级降级 + web panel**。

---

## 2. 目标用户与使用场景

### 2.1 目标用户

- 用 dsh 跑**长任务 / 自动化任务**的开发者（自动化编码、深度研究、多步工具编排）。
- 对 Agent 运行成本与稳定性敏感的个人 / 团队。

### 2.2 典型场景

| 场景 | 痛点 | dsh-watchdog 的应对 |
|---|---|---|
| 自动化编码跑 100 步 | 卡在某个 bug 上反复重试 | 死循环检测 → 纠偏 → 停止并诊断 |
| 多工具编排任务 | 某个 API 临时抖动导致中断 | 工具重试 + 指数退避 + 降级兜底 |
| 深度研究长任务 | 上下文越滚越大导致遗忘 | 阈值触发摘要压缩 / 裁剪 |
| 批量跑任务后复盘 | 不知道哪一步烧了最多 token | web 面板轨迹回放 + 统计 |

---

## 3. 核心能力

| 能力 | 说明 | 实现模块 |
|---|---|---|
| **死循环检测** | 滑动窗口内动作去重率 + 信息增量 + token 斜率，三态状态机 `NORMAL → SUSPECTED → CONFIRMED` | `sentinel/*` + `guards/loop-guard` |
| **工具失败重试** | 挂载 `tools/execute`（around-dispatch），指数退避重试 → 备用工具切换 → 只读兜底 → 交还用户 | `guards/tool-retry` |
| **上下文膨胀守卫** | 软阈值通过 `agent.steer()` 注入压缩提示，硬阈值限制 maxTokens + 标记 needsTrim | `guards/context-guard` |
| **多级降级动作链** | L1 nudge(`agent.steer()`) → L2 downgrade(seed patch) → L3 stop(`agent.cancel()`) | `actions/*` |
| **可观测性** | JSONL 结构化日志（ESM 兼容 + Windows 路径修复） + 诊断报告 + web 面板 | `report/*` |

---

## 4. 快速开始

### 4.1 体验（无需 dsh 环境）

```bash
cd dsh-watchdog
node demo.mjs    # 演示 4 个核心场景：正常流程 / 死循环 / 工具重试 / 上下文膨胀
npm test         # 58 个单元测试，覆盖全部核心逻辑
```

### 4.2 安装

```bash
npm install dsh-watchdog
```

### 4.3 注册插件

在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中添加：

```yaml
- insert:
    - id: dsh-watchdog
      name: dsh-watchdog
```

### 4.4 配置

```typescript
import { apply } from 'dsh-watchdog'

// Cordis 插件注册
ctx.plugin(apply, {
  enabled: true,
  loopGuard: {
    enabled: true,
    windowK: 5,        // 滑动窗口步数
    dedupSoft: 0.6,    // 去重率软阈值（进入 SUSPECTED）
    dedupHard: 0.9,    // 去重率硬阈值（直接 CONFIRMED）
    infoGain: 0.2,     // 信息增量阈值
    stallSteps: 3,     // SUSPECTED→CONFIRMED 容忍步数
  },
  toolRetry: {
    enabled: true,
    maxRetries: 3,
    backoffMs: [1000, 3000, 9000],
  },
  contextGuard: {
    enabled: true,
    softTokens: 80000,   // 软阈值 token 数
    hardTokens: 110000,  // 硬阈值 token 数
  },
  actions: {
    nudgeSteps: 3,       // L1 纠偏观察步数
  },
})
```

---

## 5. 功能详解

### 5.1 死循环 / 无进展检测（loop-guard）

**目标**：在 Agent 陷入无进展循环时及时识别，避免 token 浪费。

- 通过 `agent/request` 的 `payload.agent.session.events` 累积 step 轨迹。
- 维护**三态状态机**：`NORMAL → SUSPECTED → CONFIRMED`。
- 使用**组合判据**（非单一计数）判断"无实质进展"：
  1. **动作去重率**：近 K 步内工具名 + 参数签名的重复比例。
  2. **信息增量**：工具返回内容中有效新信息是否持续递减（如反复返回同一报错）。
  3. **token 消耗斜率**：步数增长而有效输出 token 近乎为 0。
- 阈值全部可配置（K、M、重复比例阈值、信息增量阈值）。
- 检测到后触发 §9 的动作链，并生成诊断报告。

**验收标准**（对应 `tests/fsm.spec.ts`）：
- 构造一个"连续 5 步重复同一失败命令"的 mock 轨迹，能在 CONFIRMED 时被正确识别。
- 构造一个"慢但每步有新进展"的轨迹，不被误杀。
- 诊断报告能列出：重复的动作、每步 token、卡死起始步。

### 5.2 工具失败重试与降级（tool-retry）

**目标**：工具调用失败不直接中断任务。

拦截工具调用失败（挂载 `tools/execute`，around-dispatch），按策略执行：

1. **重试**：指数退避重试同工具（可配最大次数）。
2. **换备用工具**：若声明了等价备用工具，切换。
3. **只读兜底**：降级为只读查询类工具。
4. **交还用户**：仍失败则终止该工具链，交还用户决策。

每一级的策略与参数可配置。

**验收标准**（对应 `tests/plugin.spec.ts`）：
- 工具第一次失败、第二次成功时，自动重试不中断。
- 连续失败达到阈值后，能按降级链走到"交还用户"，并输出完整失败链路日志。

### 5.3 上下文膨胀守卫（context-guard）

**目标**：在上下文接近窗口上限前主动压缩，防止遗忘与幻觉。

- 监控当前上下文 token 用量（从 `assistant/message.data.usage` 读取，C3 修复）。
- 超过软阈值时，返回 `compressionPrompt`，由 index.ts 通过 `agent.steer()` 注入**摘要压缩指令**（M5 修复）。
- 超过硬阈值时，限制 `maxTokens` + 标记 `needsTrim`（需历史裁剪）。
- 软/硬阈值可配置。

**验收标准**（对应 `tests/plugin.spec.ts`）：
- mock 一段持续增长的上下文，超过软阈值后能观测到注入的压缩指令。
- 超过硬阈值后，被裁剪的部分不再出现在后续请求中。

### 5.4 多级降级动作链（actions）

**目标**：拦截不是"一刀切"，而是按代价递增逐级尝试。

```
检测到异常
  ├─ L1 纠偏：注入提示，让模型自我修正（1 次机会）
  ├─ L2 降级：降级配置重跑（限制步数 / 简化工具集 / 换模型路由）
  └─ L3 停止：硬停止 + 诊断报告 + 交还用户
```

- 每级有独立触发条件与回退逻辑。
- 前一级失败自动进入下一级。
- 所有动作**可逆**：插件卸载后 Agent 完全恢复原状（Cordis `ctx.effect` disposer）。

**验收标准**（对应 `tests/plugin.spec.ts`）：
- 模拟"纠偏成功"场景，任务在 L1 恢复且未进入 L2/L3。
- 模拟"全部失败"场景，最终在 L3 停止并产出诊断报告。

### 5.5 可观测性面板（web dashboard）

**目标**：把守卫过程可视化，便于复盘与调参。

- 检测事件时间线（哪一步触发、触发的是哪类异常、执行了哪级动作）。
- 轨迹回放（逐步查看 step 内容）。
- token / 步数 / 拦截次数统计。
- 阈值配置界面（读/写 `settings`）。

**验收标准**：
- 一次运行结束后，面板能完整展示时间线、轨迹与统计。
- 面板上修改阈值后，下一次运行立即生效。

> 若 client 半开发成本高，v0.1 可先用**独立静态页**读取 JSONL（不依赖 dsh runtime），web 面板作为一个独立可视化工具。

---

## 6. 总体架构

```
┌────────────────────────────────────────────────────────────┐
│                       dsh 运行时 (Cordis)                    │
│                                                            │
│   Agent Loop ── agent/request (waterfall) ── 每步请求前触发  │
│   Agent Loop ── agent/request-error ── 请求失败时触发        │
│   Agent Loop ── tools/execute ── 工具执行（around-dispatch） │
│   session.events ── 含 tool/call、tool/result 历史轨迹       │
└─────────┬───────────────────────────────────┬──────────────┘
          │                                   │
┌─────────▼───────────────────────────────────▼──────────────┐
│                     dsh-watchdog (插件)                      │
│                                                            │
│  ┌─────────────────────────────────────────────────────┐  │
│  │            Sentinel Core（轨迹引擎）                 │  │
│  │  · 从 agent/request 的 payload.agent.session.events │  │
│  │    读取最近 tool/call 历史，累积轨迹                  │  │
│  │  · 计算进展度量（metrics.ts）                        │  │
│  │  · 维护三态状态机（fsm.ts）                          │  │
│  └──────────┬──────────────────────────┬───────────────┘  │
│             │ 状态/度量                  │ 事件             │
│  ┌──────────▼─────────┐   ┌────────────▼───────────────┐  │
│  │ 三个 Guard 插件     │   │  Actions（多级降级编排）     │  │
│  │ · loop-guard       │   │ · nudge (L1)               │  │
│  │ · tool-retry       │   │ · downgrade (L2)           │  │
│  │ · context-guard    │   │ · stop (L3) + 诊断报告      │  │
│  └──────────┬─────────┘   └────────────┬───────────────┘  │
│             │                          │                  │
│  ┌──────────▼──────────────────────────▼───────────────┐  │
│  │   Report（logger.ts + diagnostic.ts）                 │  │
│  │   → JSONL 结构化日志 → web 面板数据源                  │  │
│  └─────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

### 设计原则

1. **不侵入主循环**：只通过 dsh 暴露的扩展点干预，绝不 fork 核心（官方原则："Plugins, not loop changes"）。
2. **一切干预可逆**：所有副作用通过 Cordis 生命周期清理（`ctx.effect` 返回 disposer），插件卸载后 Agent 恢复原状。
3. **守卫分层解耦**：三个守卫各自独立、可单独开关，共享一个轨迹引擎（Sentinel Core）。
4. **先度量后行动**：拦截决策基于可解释的"进展度量"，不是魔法数字。

### 模块设计

#### Sentinel Core（轨迹引擎）—— 纯函数，零依赖，可单测

```ts
// src/sentinel/watch.ts
export class SentinelWatch {
  constructor(config: WatchdogConfig)
  reset(): void
  watch(events: readonly SessionEvent[]): WatchResult  // 读历史 → 计算度量 → 推进状态机 → 返回决策
}
```

三个 Guard 复用同一个 `watch()` 的度量结果，各自只消费自己关心的信号。

#### 三个 Guard

| 模块 | 触发源（扩展点） | 输出 |
|---|---|---|
| `loop-guard.ts` | `agent/request` 读 session.events | `LoopGuardResult`（含 seed + metrics）→ 触发 actions |
| `tool-retry.ts` | `tools/execute`（around-dispatch） | 重试 / 备用工具 / 只读 / 交还用户 |
| `context-guard.ts` | `agent/request` 读 token 计数 + `agent/request-error` 溢出 | `ContextGuardResult`（含 compressionPrompt + needsTrim） |

---

## 7. 与 dsh / Cordis 的集成

### 7.1 挂载位置：host composition

守卫逻辑是跨会话的全局底座，挂在 **host 半**（Node 进程），通过 profile 挂载。

### 7.2 使用的扩展点（已确认，来源 dsh-handbook §3.4 + v0.2.0 实测修正）

| 扩展点 | 位置 | 用途 | watchdog 用在哪 |
|---|---|---|---|
| `agent/request` waterfall | agent-loop | 每次模型请求前改 provider/model/reasoningEffort/tools | loop-guard、context-guard、action-chain |
| `agent/request-error` | agent-loop | 请求失败时干预（官方 compaction 用它做 `CONTEXT_WINDOW_EXCEEDED` 恢复） | context-guard |
| `tools/execute` | tools | 工具实际执行（around-dispatch）—— **v0.2.0 修正**：tool-retry 的真正挂点 | tool-retry |
| `conversationEvents.register` | client runtime | 订阅/注入对话事件 | web 面板（client 半） |
| `ctx.slots.inject` | client ui-slots | 注入 UI | web 面板（可选） |
| `settings` 服务 | dsh-settings | 注册用户配置命名空间，设置页自动渲染 | 阈值配置 |
| `ctx.provide` / `ctx.get` | cordis | 跨插件提供服务 | Sentinel 服务注册 |

> ⚠️ **v0.2.0 挂载点修正（C5）**：早期设计把 tool-retry 挂 `tools/post-execute`，但 `PostToolDecision` 只有 `accept`/`block` 两种，**无法重试**。已改为挂 `tools/execute`（around-dispatch），在 `await next()` 后判断失败并重试。
>
> ⚠️ **`agent/request-error` 只处理模型请求失败**，不覆盖工具调用失败。工具失败走 `ctx.tools` 服务的三个事件（`pre-execute` / `execute` / `post-execute`）。

### 7.3 插件入口与 waterfall 用法

```ts
// src/index.ts
ctx.on('agent/request', async (payload: AgentRequestPayload, next: () => Promise<LlmCallConfig>) => {
  const seed = await next()   // ⚠️ 必须 await，否则上游 provider/model/tools 丢失
  // loop-guard + context-guard 消费 seed，actionChain.execute 接通 L1/L2/L3
  return seed
})
```

**事件结构**（从 `session.events` 读，对齐真实 dsh SessionEventMap）：

```ts
// v0.1 假设（错误）
{ type: 'tool/result', data: { content: 'string' } }

// v0.2.0 对齐后（C3 修复）—— content 是 ContentBlock[]，不是 string
{ type: 'tool/result', data: { turn, step, message: { role: 'tool', content: ContentBlock[] } } }
{ type: 'assistant/message', data: { turn, step, message, usage?: TokenUsage } }  // token 在此
{ type: 'tool/call', data: { turn, step, callId, name, arguments } }
{ type: 'turn/end', data: { turn, reason: { kind }, usage? } }
```

---

## 8. 核心算法：死循环检测状态机

### 8.1 三态状态机

```
   ┌──────▼──────┐   强信号      ┌───────┴──────┐   持续 M 步      ┌──────────┐
   │   NORMAL    │ ──────────►  │  SUSPECTED   │ ─────────────► │ CONFIRMED│
   └─────────────┘              └───────┬──────┘                 └────┬─────┘
          ▲                             │ 出现有效新信息              │
          └─────────────────────────────┘                          ▼
                                                              触发 Actions
```

**状态转移（`fsm.ts`，纯函数）：**

```
NORMAL ──[dedupRatio > T1 或 infoGain < G1]──→ SUSPECTED
SUSPECTED ──[dedupRatio ≤ T1]──→ NORMAL（恢复）          // 恢复只看去重率（L2 修复）
SUSPECTED ──[dedupRatio > T2 或 stallSteps ≥ M]──→ CONFIRMED（终态）
CONFIRMED ── 终态，不再转移
```

> **v0.2.0 修正（L2）**：早期伪代码中 SUSPECTED→NORMAL 恢复条件写的是 `infoGain >= G1`，但 infoGain 会随历史累积自然衰减，导致慢任务被误杀。实际恢复条件**仅检查 `dedupRatio <= dedupSoft`**（低去重率说明 Agent 在尝试不同策略）。

### 8.2 进展度量（组合判据）

对滑动窗口（近 K 个 `tool/call`）计算三个信号（`metrics.ts`，纯函数）：

1. **动作去重率**（`dedupRatio`）：`actionSignature = name + normalize(arguments)`，取窗口内最高频签名占比。
   - v0.2.0 修正（M6）：参数归一化只替换**以 `/` 或 `X:\` 开头的整个字符串值**，不再对"包含路径片段的命令"做整体替换。
2. **信息增量**（`infoGain`）：工具返回内容相对历史的"新信息"占比。用字符 n-gram 去重率近似（不引入 embedding 依赖）。
   - v0.2.0 修正（C3）：从 `tool/result.data.message.content`（ContentBlock[]）提取文本。
3. **token 消耗斜率**（`tokenSlope`）：有效输出 / 步数，趋近 0 说明"只调工具不出活"。
   - v0.2.0 修正（C3）：从 `assistant/message.data.usage` 读取。

### 8.3 可调参数

| 参数 | 含义 | 建议默认 |
|---|---|---|
| `windowK` | 滑动窗口步数 | 5 |
| `dedupSoft` | 去重率软阈值（进 SUSPECTED） | 0.6 |
| `dedupHard` | 去重率硬阈值（直接 CONFIRMED） | 0.9 |
| `infoGain` | 信息增量阈值 | 0.2 |
| `stallSteps` | SUSPECTED→CONFIRMED 容忍步数 | 3 |

---

## 9. 多级降级动作链

```
检测异常
  ├─ L1 纠偏（nudge）：通过 agent.steer() 注入纠偏提示，观察 N 步是否恢复
  ├─ L2 降级（downgrade）：改 seed 配置（降低 reasoningEffort / 限制 maxTokens）重跑
  └─ L3 停止（stop）：硬停止 agent.cancel() + 诊断报告 + 交还用户
```

### 9.1 L3「停止」的实现（已对照源码确认 + v0.2.0 接通）

L3 采用**硬停止为主、软停止为辅**的双轨：

1. **硬停止（主）**：`agent.cancel({ kind: 'hook', reason: 'watchdog-loop-detected' })` —— 经 `AbortController.abort()` 让当前 turn 以 `{kind:'aborted', reason}` 结束（durable 进 transcript）。干净、可靠、可编程触发。
2. **软停止（辅）**：`agent.steer(msg)` 注入一条"检测到无进展，请停止并总结"的 user 消息进入 next-step，模型自然收尾——用于希望保留模型总结能力、而非硬断的场景。

> ⚠️ 早期设计里 L3 用 `{ ...seed, tools: [] }` 清空工具集**不可行**，已纠正：`agent/request` 的 seed（`LlmCallConfig`）不含 `tools` 字段，`tools` 由 loop 在瀑布之外经 `systemPrompt.assemble` 组装。对照源码后，L3 改用 `agent.cancel` / `agent.steer` 实现。

### 9.2 v0.2.0 接通情况（C4）

v0.1.0 中动作链**未接通**（`actionChain.execute` 从未被调用，L1/L2/L3 全部空操作）。v0.2.0 已修复：

- `index.ts` 在 `agent/request` 中调用 `actionChain.execute()`。
- L1 nudge 通过 `agent.steer()` 注入纠偏提示。
- L3 stop 通过 `agent.cancel()` 执行硬停止（无 cancel 时降级为 `agent.steer()` 软停止）。
- L2 downgrade 通过修改 seed 的 `reasoningEffort` / `maxTokens` / `temperature` 实现。
- `loop-guard.handleRequest` 返回 `LoopGuardResult`（含 `metrics`），供 `actionChain.checkRecovery()` 做 L1 恢复判定（H2 修复）。

### 9.3 各动作接口

```ts
interface ActionChain {
  execute(payload, seed): Promise<{ level: 'L1'|'L2'|'L3', patch?, nudgePrompt?, terminated?, report? }>
  checkRecovery(metrics): boolean   // L1 注入后观察 N 步是否恢复
}
```

---

## 10. 数据流时序（一次死循环被拦停）

```
Agent Loop          agent/request        Sentinel Core        FSM         Actions
    │                    │                     │                │              │
    │── step_1 ─────────►│─── session.events ──►│ ingest          │              │
    │── step_2 ─────────►│─────────────────────►│ 计算 metrics    │─ dedup 0.4 → NORMAL
    │   ...              │                     │                │              │
    │── step_k ─────────►│─────────────────────►│ dedupRatio=0.7 │─ SUSPECTED   │
    │── step_k+1..k+M ──►│─────────────────────►│ infoGain 持续低 │─ CONFIRMED ──►│
    │                    │<──── 注入纠偏提示 ────│                │              │─ nudge(L1)
    │── 后续 N 步 ───────►│─────────────────────►│ 仍无新信息      │              │─ downgrade(L2)
    │                    │<── cancel(hook) ──────│                │              │─ stop(L3) 硬停
    │                    │                     │                │              │─ 诊断报告
    ▼                    ▼                     ▼                ▼              ▼
```

---

## 11. 配置设计

所有阈值通过 `settings` 服务暴露，支持默认值 + 用户覆盖，运行时 live 生效。

```yaml
# ~/.dsh/settings.yaml（经 settings 服务注册命名空间后自动渲染表单）
watchdog:
  enabled: true
  loopGuard:
    enabled: true
    windowK: 5
    dedupSoft: 0.6
    dedupHard: 0.9
    infoGain: 0.2
    stallSteps: 3
  toolRetry:
    enabled: true
    maxRetries: 3
    backoffMs: [1000, 3000, 9000]
  contextGuard:
    enabled: true
    softTokens: 80000
    hardTokens: 110000
  actions:
    nudgeSteps: 3
```

### 配置校验（v0.2.0 新增，L3）

`mergeConfig()` 对关键约束进行校验，非法配置抛出错误：

- `loopGuard.windowK > 0`
- `loopGuard.dedupSoft < loopGuard.dedupHard`
- `loopGuard` 阈值范围 `[0, 1]`
- `toolRetry.maxRetries >= 0`
- `toolRetry.backoffMs` 非空（当 maxRetries > 0）
- `contextGuard.softTokens < contextGuard.hardTokens`

---

## 12. 可观测性

### 12.1 JSONL 结构化日志

守卫事件追加写入 `~/.dsh/watchdog/events.jsonl`（v0.2.0 M4 修复：Windows 优先 `USERPROFILE`），作为 web 面板数据源。

日志类型：`loop-guard:state-change`、`loop-guard:confirmed`、`tool-retry:attempt/exhausted/fallback/readonly`、`context-guard:soft-threshold/hard-threshold`、`action:nudge/downgrade/stop`。

> v0.2.0 修复（C2）：ESM 环境下 `require` 全局不存在，改用 `createRequire(import.meta.url)` 惰性加载 `node:fs`/`node:path`，已验证 `node demo.mjs` 真实运行不再崩溃。

### 12.2 诊断报告

`DiagnosticReportBuilder` 生成结构化诊断报告：时间戳、状态、触发原因、停滞步数、重复动作、token 消耗。

### 12.3 web 面板

- **client 半**：`package.json` 声明 `dsh.client` + `exports["./client"]`，浏览器侧 `apply(ctx)`，通过 `conversationEvents.register` 订阅事件。
- **数据通道**：host 半把事件与诊断追加写入 JSONL；client 半通过 `ctx.provide`/`ctx.get` 桥接 host 服务读取。
- **页面模块**：时间线 / 轨迹回放 / token 统计 / 阈值配置。

> 若 client 半开发成本高，v0.1 可先用**独立静态页**读取 JSONL（不依赖 dsh runtime）。

---

## 13. 目录结构

```
dsh-watchdog/
├── docs/
│   ├── PRD.md                    # 需求文档（本文档已整合）
│   └── ARCHITECTURE.md           # 架构文档（本文档已整合）
├── src/
│   ├── index.ts                  # 入口：agent/request waterfall + actions 接通
│   ├── env.d.ts                  # Node.js 最小类型声明（@types/node 不可用时）
│   ├── settings.ts               # 配置 schema + mergeConfig（含校验）
│   ├── sentinel/
│   │   ├── types.ts              # 核心类型定义（对齐真实 dsh SessionEventMap）
│   │   ├── metrics.ts            # 进展度量（去重率/信息增量/token斜率，纯函数）
│   │   ├── fsm.ts                # 三态状态机（纯函数）
│   │   └── watch.ts              # SentinelWatch 聚合函数
│   ├── guards/
│   │   ├── types.ts              # Guard 类型补充
│   │   ├── loop-guard.ts         # 死循环检测守卫（返回 LoopGuardResult 含 metrics）
│   │   ├── tool-retry.ts         # 工具失败重试守卫（挂载 tools/execute）
│   │   └── context-guard.ts      # 上下文膨胀守卫（返回 ContextGuardResult 含 compressionPrompt）
│   ├── actions/
│   │   ├── index.ts              # 多级降级编排（L1→L2→L3）
│   │   ├── nudge.ts              # L1 纠偏
│   │   ├── downgrade.ts          # L2 降级
│   │   └── stop.ts               # L3 停止（agent.cancel 硬停 + steer 软停）
│   └── report/
│       ├── logger.ts             # JSONL（ESM 兼容 createRequire + Windows 路径）
│       └── diagnostic.ts         # 诊断报告
├── tests/
│   ├── metrics.spec.ts           # 进展度量（17 用例，真实 ContentBlock[] 事件）
│   ├── fsm.spec.ts               # 状态机全分支（17 用例）
│   ├── watch.spec.ts             # SentinelWatch 聚合（8 用例）
│   └── plugin.spec.ts            # Guard + 契约测试（16 用例）
├── lib/                          # 编译产物（package.json 入口指向此处，H3 修复）
├── demo.mjs                      # 功能演示脚本（node demo.mjs）
├── cordis.patch.yml
├── package.json
├── tsconfig.json
└── README.md
```

---

## 14. 技术栈与依赖

| 层 | 选型 | 版本 |
|---|---|---|
| 语言 | TypeScript | ^5.6 |
| Cordis | `@deepseek-ai/cordis` | ^4.0.1（peer） |
| dsh agent | `@deepseek-ai/dsh-agent` | ^0.1.0-rc.6（peer） |
| 测试 | vitest | ^3.0 |
| 前端 | 原生 + ECharts（client 半或独立静态页） | — |

> ⚠️ 依赖务必用 `^0.1.0-rc.6` 线，rc.1 线 npm 依赖链断裂（handbook §3.5）。

> **v0.2.0 打包修复（H3）**：`package.json` 的 `main`/`types`/`exports` 指向 `./lib/`（编译产物），并添加 `files: ["lib", "README.md"]`。早期指向 `src/index.ts` 导致发布后无法运行。

---

## 15. API 交叉验证结果（对照官方源码逐条敲定）

以下 6 项已读 `deepseek-harness` 官方源码确认（来源标注源文件路径）。

### 15.1 `agent/request` 的 payload 与 seed（✅）

- **payload（入参）** = `{ agent, turn, step, signal }` —— 不含 provider/model/tools；config 在 `next()` 的返回值里。
- **seed（`next()` 返回值）= `LlmCallConfig`**：

```ts
interface LlmCallConfig {
  provider: string
  model: string
  reasoningEffort?: 'off' | 'high' | 'max'
  temperature?: number
  maxTokens?: number
  stop?: string[]
}
```

- **用法**：`const seed = await next(); return { ...seed, reasoningEffort: 'high' }`（⚠️ 必须 `await next()`）。
- 完整请求 `GenerateOptions` 另含 `messages/system/tools/sessionId/signal`，但那是 `buildRequest` 在 waterfall 之后组装的，插件在 `agent/request` 里只能改 config 字段，改不动 messages/tools。
- 来源：`packages/core/agent-loop/src/agent.ts`（buildRequest）、`packages/llm/llm/src/call-config.ts:23`。

### 15.2 工具失败事件 + request-error（✅）

- `agent/request-error` **只处理模型请求失败**（`finish.kind === 'error' | 'aborted'`），**不覆盖工具调用失败**。
  - payload `{ turn, step, provider, failure, retryPolicy, signal }`；`failure` = `LlmFailure { message, code }`。
  - 返回 `RequestErrorAction = { kind: 'retry' } | undefined`，`{kind:'retry'}` 触发重试。
- **工具失败走 `ctx.tools` 服务的三个事件**（tool-retry 的正确挂点，C5 已修正）：

```ts
tools/pre-execute  (exec, next) => PreToolDecision     // {kind:'allow'} | {kind:'deny',reason} | {kind:'ask',reason?}
tools/execute      (exec, next) => ToolExecutionResult // 实际执行，可包超时/重试（watchdog 挂这里）
tools/post-execute (exec, result, next) => PostToolDecision
// PostToolDecision = {kind:'accept', content?|value?} | {kind:'block', feedback}
// ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure({isError:true, error: ToolFailure})
```

- 来源：`packages/core/tools/src/index.ts:588-600`、`packages/core/agent-loop/src/agent.ts:373-390`。

### 15.3 settings 注册 API（✅）

```ts
ctx.settings.register<T>(ns, schema, opts): SettingsScope<T>
// ns     : SettingsNamespace（branded，^[a-z][a-z0-9-]*$ kebab-case）
// schema : schemastery z<T>
// opts   : { base?: Partial<T>, applies?: 'live'|'restart', validate?: (v:T)=>void }
// SettingsScope<T>: { get(): T, watch(cb), update(patch), replace(section) }
```

- 便捷封装 `installSettingsSection(ctx, ns, schema, entry, hooks)`。
- 事件：`settings/updated(ns, next, prev, source)`、`settings/document-updated(ns, revision)`。
- 并发写：revision 乐观锁，冲突抛 `SettingsConflictError`。
- 来源：`packages/settings/settings/src/index.ts`。

### 15.4 `ctx.slots.inject`（✅，属 client 半）

- slots 是 **client 半（browser）UI 概念**，不是 host 半服务。
- 纯类型包 `@deepseek-ai/dsh-client-ui-slots`（`SlotCore`，React-free + cordis-free）；runtime 包 `ui-renderer` 负责实现与插件生命周期安装。
- `ctx.slots.inject` 在 **runtime 包**；`SlotCore.register({...}, Component)` 一次注册贡献组件 + 声明子 slot。
- 来源：`packages/client/ui-slots/README.md`。

### 15.5 硬停止（✅ 已确认可行）

```ts
agent.cancel(cause: AgentCancelCause, options?: CancelOptions): void
type AgentCancelCause =
  | { kind: 'user' } | { kind: 'parent' }
  | { kind: 'hook'; reason: string }   // ← watchdog 用它：reason 写死循环判定依据
  | { kind: 'disposed' }
```

- `cancel()` → `phase.abort.abort(cause)` → 当前 turn 以 `{kind:'aborted', reason: cause}` 结束（durable 进 transcript）。
- 插件经 `payload.agent` 拿引用，`agent.cancel({kind:'hook', reason:'watchdog-loop-detected'})` 即可**硬停当前 turn**。
- 软停止仍可用 `agent.steer(msg)`（next-step 注入）/ `agent.inject(msg)`（注入不唤醒）。
- 来源：`packages/core/agent-loop/src/agent.ts:134-140`、`packages/core/session/src/types.ts:143-147`。

### 15.6 `guard/*` 官方包名 + loop hygiene（✅）

- `packages/guard/` 下**只有两个包**：
  1. `repeat-tool-reminder`（`@deepseek-ai/dsh-repeat-tool-reminder`）—— 连续重复调用检测，**只 nudge 不 veto**；挂点 `tools/post-execute` + `agent/pre-step`。
  2. `timeout-policy`（`@deepseek-ai/dsh-tool-call-timeout-policy`）—— 工具超时强制，**只超时不重试**；挂点 `tools/execute`。
- loop hygiene 官方能力 = 上述两 guard + `dsh-compaction-basic`（`agent/pre-step` 压力 + `agent/request-error` 溢出）。
- **watchdog 差异化**：官方 guard 均单点 / 无状态 / 被动；watchdog 做跨指标联合三态 FSM + L1/L2/L3 多级降级 + web panel。
- 来源：`packages/guard/repeat-tool-reminder/src/index.ts`、`packages/guard/timeout-policy/src/index.ts`。

---

## 16. 验证方法

三层验证：

1. **纯函数单测**：`watch()` / `metrics()` / `fsm()` 零依赖，毫秒级覆盖全分支。
2. **waterfall 契约测试**：最小 Context 替身，断言 `await next()`、`provider/model/tools` 字段不丢失、只覆盖目标字段。
3. **实机验证**：官方 `mock:llm`（`--sequence tool_call_success,success`）+ headless profile + `--patch ./plugin-test.cordis.yml` 注入测试插件，断言 session JSONL 出现 `tool/call`、`turn/end.reason.kind === 'completed'`。

### 当前测试状态（v0.2.0）

```
Test Files  4 passed (4)
     Tests  58 passed (58)
```

| 测试文件 | 用例数 | 覆盖内容 |
|---|---|---|
| `tests/metrics.spec.ts` | 17 | 进展度量（去重率/信息增量/token 斜率/路径归一化），真实 ContentBlock[] 事件 |
| `tests/fsm.spec.ts` | 17 | 状态机全分支（含 SUSPECTED→NORMAL 恢复路径） |
| `tests/watch.spec.ts` | 8 | SentinelWatch 聚合，真实事件结构 |
| `tests/plugin.spec.ts` | 16 | Guard 契约 + C3 token 估算 + mergeConfig 校验 |

---

## 17. 范围边界

- 不做**多 Agent 之间的协作调度**（那是编排器的事）。
- 不做**训练侧对齐 / RL**。
- 不做**幻觉的语义级判断**（只做可结构化度量的"无进展"判断）。
- 不做**跨会话的持久化记忆**（只处理当前会话上下文）。

---

## 18. 里程碑

| 里程碑 | 内容 | 可独立 demo 的产出 |
|---|---|---|
| **M1** | 死循环检测核心（状态机 + 组合判据） | 能拦停卡死 Agent + 输出诊断 |
| **M2** | 工具失败重试与降级 | 失败自动恢复，不中断任务 |
| **M3** | 上下文膨胀守卫 | 超阈值自动压缩 |
| **M4** | 多级降级动作链整合 | L1→L2→L3 完整联动 |
| **M5** | web 面板 | 可视化时间线 + 轨迹回放 + 统计 |

> 每个里程碑独立可用、可 demo。M1–M4 的核心逻辑已在 v0.2.0 实现并通过 58 个单测；M5（web 面板）为待办。

---

## 19. 风险与依赖

| 风险 | 影响 | 缓解 |
|---|---|---|
| dsh 处于开发者预览，API 可能破坏性变更 | 代码返工 | 锁定 `dsh-handbook` 对应版本，关注 changelog |
| 事件字段名与假设不符 | 事件订阅失效 | v0.2.0 已对照官方源码对齐（C3），落地前再对照 handbook 确认 |
| 死循环"误杀"慢任务 | 用户体验受损 | 三态状态机 + 可调阈值 + 恢复条件只看去重率（L2） |
| 范围过大（三能力 + 面板） | 工期失控 | 严格按里程碑推进，每步可 demo |
| `settings.register` 依赖运行时 Cordis 环境 | 无法单测 | 配置合并/校验已单测；注册逻辑需实机验证 |

依赖清单：

- DeepSeek Harness CLI（`npx @deepseek-ai/dsh`）本地可运行。
- [dsh-handbook](https://github.com/Electricitysheep/dsh-handbook)（插件开发手册）。
- [dsh-plugin-mcp](https://www.npmjs.com/package/dsh-plugin-mcp)（Cordis 原生插件范例）。
- 插件市场（用于发布）：`dsh-market` / `2BingLing/dsh-market`。

---

## 20. 变更日志

### v0.2.0 (2026-08-25) — 基于功能验证报告的系统性优化

**Critical 修复：**
- **C1**：TypeScript 编译通过（添加 `src/env.d.ts` 类型声明；修复 actions/index.ts 类型收窄错误；logger.ts null 赋值）。
- **C2**：ESM 兼容 —— `require` 全局在 ESM 中不存在，改用 `createRequire(import.meta.url)` 惰性加载 `node:fs`/`node:path`；已验证真实运行不崩溃。
- **C3**：事件字段对齐真实 SessionEventMap —— `tool/result.data.message.content: ContentBlock[]`、`assistant/message.data.usage`。
- **C4**：多级降级动作链接通 —— L1 通过 `agent.steer()` 注入、L3 通过 `agent.cancel()` 执行。
- **C5**：工具重试改挂 `tools/execute`（around-dispatch），`PostToolDecision` 无 retry 的问题解决。

**High 修复：**
- **H2**：loop-guard 返回 `LoopGuardResult`（含 metrics），供 actionChain.checkRecovery 使用。
- **H3**：package.json 入口指向 `lib/`，添加 `files` 字段。

**Medium 修复：**
- **M1**：移除 `on` 类型强转，使用正确的多参 handler 签名。
- **M2**：`logToolRetry` 参数扩展为 `success/failed/retrying/fallback/readonly`。
- **M3**：`ctx.effect` 返回 disposer（卸载时执行 reset）。
- **M4**：Windows 日志路径优先 `USERPROFILE`。
- **M5**：上下文守卫软阈值注入压缩提示（`agent.steer()`），硬阈值限制 maxTokens + needsTrim。
- **M6**：actionSignature 路径归一化只替换完整路径字符串值。
- **M7**：watch() 无状态版死分支修复。

**Low 修复：**
- **L2**：FSM 恢复条件注释与代码一致（仅看 dedupRatio）。
- **L3**：mergeConfig 添加 6 项配置校验。

**测试**：58/58 通过，全部使用真实 dsh 事件结构（ContentBlock[] + assistant/message usage）。

**新增**：`demo.mjs` 功能演示脚本、`src/env.d.ts` 类型声明、`优化报告.md`。

---

## License

MIT
