import type { Budget } from "./schema"

/**
 * Central budget checks (invariant #3). The orchestrator calls these — a Worker cannot exceed its
 * budget even if its own prompt tells it to.
 */
export function remainingCents(budget: Budget): number {
  return Math.max(0, budget.limitCents - budget.spentCents)
}

export function withinBudget(budget: Budget): boolean {
  return budget.spentCents < budget.limitCents
}

/**
 * Whether a budget's window has rolled over since `periodStartIso` and spend should reset (ENG-007).
 * The window is the calendar month (UTC), so `monthlyBudgetCents` is a real monthly allowance rather
 * than a lifetime total that only ever grows.
 */
export function periodExpired(periodStartIso: string, now: Date): boolean {
  const start = new Date(periodStartIso)
  return (
    now.getUTCFullYear() !== start.getUTCFullYear() || now.getUTCMonth() !== start.getUTCMonth()
  )
}

/**
 * Whether a reservation of `cents` fits within the budget without exceeding the limit (ENG-007). Used
 * to hold worst-case cost up front so concurrent runs for one scope can't jointly overspend.
 */
export function canReserve(budget: Budget, cents: number): boolean {
  return budget.spentCents + cents <= budget.limitCents
}
