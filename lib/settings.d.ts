/**
 * dsh-watchdog 配置管理
 *
 * 通过 Cordis settings 服务注册 watchdog 命名空间，
 * 支持默认值 + 用户覆盖，运行时 live 生效。
 *
 * 注意：由于 @deepseek-ai/cordis 是 peerDependency，
 * 本模块导出 schema 定义和默认值，实际注册由 index.ts 在插件入口完成。
 */
import type { WatchdogConfig } from './sentinel/types.js';
export { DEFAULT_CONFIG } from './sentinel/types.js';
export type { WatchdogConfig, LoopGuardConfig, ToolRetryConfig, ContextGuardConfig, ActionsConfig } from './sentinel/types.js';
/**
 * 配置 schema 定义（供 Cordis settings.register 使用）
 *
 * schema 采用 schemastery 风格的对象描述，
 * 实际注册时由 index.ts 中 ctx.settings.register 消费。
 */
export declare const configSchema: {
    readonly enabled: {
        readonly type: "boolean";
        readonly default: boolean;
        readonly desc: "是否启用 watchdog 插件";
    };
    readonly loopGuard: {
        readonly type: "object";
        readonly desc: "死循环 / 无进展检测";
        readonly default: import("./settings.js").LoopGuardConfig;
        readonly properties: {
            readonly enabled: {
                readonly type: "boolean";
                readonly default: boolean;
                readonly desc: "是否启用死循环检测";
            };
            readonly windowK: {
                readonly type: "number";
                readonly default: number;
                readonly desc: "滑动窗口步数";
            };
            readonly dedupSoft: {
                readonly type: "number";
                readonly default: number;
                readonly desc: "去重率软阈值（进入 SUSPECTED）";
            };
            readonly dedupHard: {
                readonly type: "number";
                readonly default: number;
                readonly desc: "去重率硬阈值（直接 CONFIRMED）";
            };
            readonly infoGain: {
                readonly type: "number";
                readonly default: number;
                readonly desc: "信息增量阈值";
            };
            readonly stallSteps: {
                readonly type: "number";
                readonly default: number;
                readonly desc: "SUSPECTED→CONFIRMED 容忍步数";
            };
        };
    };
    readonly toolRetry: {
        readonly type: "object";
        readonly desc: "工具失败重试与降级";
        readonly default: import("./settings.js").ToolRetryConfig;
        readonly properties: {
            readonly enabled: {
                readonly type: "boolean";
                readonly default: boolean;
                readonly desc: "是否启用工具重试";
            };
            readonly maxRetries: {
                readonly type: "number";
                readonly default: number;
                readonly desc: "最大重试次数";
            };
            readonly backoffMs: {
                readonly type: "array";
                readonly default: number[];
                readonly desc: "指数退避等待时间(ms)";
            };
        };
    };
    readonly contextGuard: {
        readonly type: "object";
        readonly desc: "上下文膨胀守卫";
        readonly default: import("./settings.js").ContextGuardConfig;
        readonly properties: {
            readonly enabled: {
                readonly type: "boolean";
                readonly default: boolean;
                readonly desc: "是否启用上下文守卫";
            };
            readonly softTokens: {
                readonly type: "number";
                readonly default: number;
                readonly desc: "软阈值 token 数";
            };
            readonly hardTokens: {
                readonly type: "number";
                readonly default: number;
                readonly desc: "硬阈值 token 数";
            };
        };
    };
    readonly actions: {
        readonly type: "object";
        readonly desc: "多级降级动作链";
        readonly default: import("./settings.js").ActionsConfig;
        readonly properties: {
            readonly nudgeSteps: {
                readonly type: "number";
                readonly default: number;
                readonly desc: "L1 纠偏观察步数";
            };
        };
    };
};
/**
 * 合并用户配置与默认配置
 * 确保所有字段都有值，深层合并
 *
 * 修复 L3：添加基本校验，非法配置抛出错误
 */
export declare function mergeConfig(user: Partial<WatchdogConfig>): WatchdogConfig;
//# sourceMappingURL=settings.d.ts.map