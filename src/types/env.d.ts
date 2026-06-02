// Ambient type declarations for Bun-specific modules

declare module 'bun:bundle' {
  export function feature(name: string): boolean
  export const MACRO: unique symbol
  export type MACRO = typeof MACRO
}

// Bun build-time macro constant
declare const MACRO: {
  VERSION: string
  BUILD_TIME: string
  [key: string]: string | number | boolean
}

declare module 'react/compiler-runtime' {
  export function c<T extends (...args: unknown[]) => unknown>(name: string, fn: T): T
}

declare module 'qrcode' {
  function toDataURL(text: string): Promise<string>
  export = { toDataURL }
}

declare module '../assistant/index.js' {
  const mod: Record<string, unknown>
  export = mod
}
