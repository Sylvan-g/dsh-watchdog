/**
 * Node.js 类型声明（最小集）
 * 在 @types/node 不可用时提供必要的类型
 */
declare namespace NodeJS {
  interface Process {
    env: Record<string, string | undefined>
    versions: Record<string, string>
  }
}

declare var process: NodeJS.Process | undefined

declare function require(module: string): any

declare module 'node:fs' {
  function mkdirSync(path: string, options?: { recursive?: boolean }): void
  function appendFileSync(path: string, data: string, encoding: string): void
}

declare module 'node:path' {
  function join(...paths: string[]): string
  function dirname(path: string): string
}

declare module 'node:module' {
  function createRequire(filename: string | URL): (module: string) => any
}
