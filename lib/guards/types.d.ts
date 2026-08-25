/**
 * guards/types.ts - Guard 模块的本地类型补充
 *
 * Cordis Context 的最小类型替身，用于不依赖 @deepseek-ai/cordis 时的编译。
 * 生产环境中 Cordis 会提供完整的 Context 类型。
 */
/** Cordis Context 最小替身类型 */
export interface Context {
    on: (event: string, handler: (...args: any[]) => any) => void;
    effect: (cleanup: () => void | Promise<void>) => void;
    inject: (deps: string[], callback: () => void) => void;
}
//# sourceMappingURL=types.d.ts.map