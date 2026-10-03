/**
 * "12 minutes", "3 hours", "5 days" — trials can be granted in minutes for
 * testing, so a days-only countdown would read "0 days" for the whole test.
 */
export function timeLeft(ms: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  if (ms <= 0) return 'no time'
  if (ms < 3_600_000) return plural(Math.max(1, Math.ceil(ms / 60_000)), 'minute')
  if (ms < 86_400_000) return plural(Math.ceil(ms / 3_600_000), 'hour')
  return plural(Math.ceil(ms / 86_400_000), 'day')
}
