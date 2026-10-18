/**
 * Item search for the menu screen. The counter has the same code in
 * `admin/src/itemSearch.ts` — keep the two in step.
 *
 * Staff type an item's short name ("cb") or any part of its name. A short
 * name hit ranks above a name hit, so "cb" puts Chicken Biriyani first even
 * when another name happens to contain the letters.
 */
export interface Searchable { name: string; shortName?: string | null }

/** 0 = no match; higher ranks first. */
export function searchRank(item: Searchable, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const short = item.shortName?.trim().toLowerCase()
  if (short && short === q) return 3
  if (short && short.startsWith(q)) return 2
  return item.name.toLowerCase().includes(q) ? 1 : 0
}

/** The matches, best first; equal ranks keep the order they came in. */
export function searchItems<T extends Searchable>(items: T[], query: string): T[] {
  return items
    .map((item, i) => ({ item, i, rank: searchRank(item, query) }))
    .filter((r) => r.rank > 0)
    .sort((a, b) => b.rank - a.rank || a.i - b.i)
    .map((r) => r.item)
}

/** True when the query is exactly this item's short name — Enter can add it straight away. */
export const isExactShortName = (item: Searchable, query: string) => searchRank(item, query) === 3
