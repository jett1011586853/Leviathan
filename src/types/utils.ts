/**
 * Recursively makes all properties of T readonly.
 * Used pervasively in reactive state management to enforce
 * immutability on deeply nested objects.
 */
export type DeepImmutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
    : T
