/** Narrowing helpers: the mod reads JSON it did not write, and trusts none of it. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The string under `key` in `value`, if it is one. */
export function text(value: Record<string, unknown>, key: string): string | undefined {
  const found = value[key]
  return typeof found === 'string' && found !== '' ? found : undefined
}

/** The JSON a string holds, or `undefined` when it holds none. */
export function parseJson(source: string): unknown {
  try {
    return JSON.parse(source)
  } catch {
    return undefined
  }
}
