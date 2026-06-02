/**
 * Identifies the source/category of a query for analytics, routing,
 * and context assembly. The type is a branded string for safety at
 * the type level but works as a plain string at runtime.
 */
declare const QuerySourceBrand: unique symbol

export type QuerySource = string & { [QuerySourceBrand]?: true }
