/**
 * KOT routing — the highest-risk logic in the product.
 *
 * One order becomes N kitchen tickets, one per station that has items on it.
 * A single-printer shop is not a special case: it simply has one kitchen, and
 * every category points at it.
 */

export interface RoutableLine {
  id: string
  /** Resolved from the item's category. Null → fall back to the default kitchen. */
  kitchenId: string | null
  qty: number
  name: string
  note?: string | null
  /** Display names only — the ticket shows what to make, not what it costs. */
  modifiers?: string[]
}

export interface KotGroup {
  kitchenId: string
  lines: RoutableLine[]
}

/**
 * Group unsent lines by destination kitchen.
 *
 * A line whose category has no kitchen goes to `defaultKitchenId`. We never
 * silently drop a ticket — a lost KOT is an angry customer.
 *
 * Order of groups follows first appearance, so the ticket a waiter sees on the
 * review screen matches the order the printers fire in.
 */
export function routeToKitchens(
  lines: RoutableLine[],
  defaultKitchenId: string,
): KotGroup[] {
  const groups = new Map<string, RoutableLine[]>()
  for (const line of lines) {
    const target = line.kitchenId ?? defaultKitchenId
    const existing = groups.get(target)
    if (existing) existing.push(line)
    else groups.set(target, [line])
  }
  return [...groups].map(([kitchenId, ls]) => ({ kitchenId, lines: ls }))
}

/**
 * Next KOT sequence number for an order.
 * Seq 1 is the first send; everything after is an ADD-ON round.
 */
export const nextKotSeq = (existingSeqs: number[]): number =>
  existingSeqs.length === 0 ? 1 : Math.max(...existingSeqs) + 1

export const kotKindForSeq = (seq: number): 'new' | 'addon' =>
  seq === 1 ? 'new' : 'addon'
