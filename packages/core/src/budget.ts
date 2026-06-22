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
