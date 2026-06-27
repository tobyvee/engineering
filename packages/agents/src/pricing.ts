import { DEFAULT_MODEL } from "./prompt"

/** Token pricing in **cents per million tokens** (input / output). Source: Claude API pricing. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-8": { input: 500, output: 2500 },
  "claude-opus-4-7": { input: 500, output: 2500 },
  "claude-sonnet-4-6": { input: 300, output: 1500 },
  "claude-haiku-4-5": { input: 100, output: 500 },
  "claude-fable-5": { input: 1000, output: 5000 },
}

const FALLBACK = { input: 500, output: 2500 }

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function priceFor(model: string): { input: number; output: number } {
  return PRICING[model] ?? FALLBACK
}

/** Convert a Messages API usage object to cents (cache reads ~0.1×, cache writes ~1.25× input). */
export function costCentsFromUsage(model: string, usage: Usage): number {
  const p = priceFor(model)
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const inputUnits = usage.input_tokens + cacheRead * 0.1 + cacheWrite * 1.25
  const cents = (inputUnits * p.input + usage.output_tokens * p.output) / 1_000_000
  return Math.round(cents * 100) / 100
}

/**
 * Cap `max_tokens` so a single run's output cost can't exceed the remaining budget — a cheap local
 * guard; the orchestrator remains the authoritative enforcer (invariant #3).
 */
export function affordableMaxTokens(model: string, budgetCents: number, cap: number): number {
  const centsPerOutputToken = priceFor(model).output / 1_000_000
  if (centsPerOutputToken <= 0) return cap
  const affordable = Math.floor(budgetCents / centsPerOutputToken)
  return Math.max(256, Math.min(cap, affordable))
}

/**
 * Worst-case cost (cents) to hold up front for one run (ENG-007): the affordable output-token cap at
 * the model's output rate. Reserving this per run lets concurrent runs for a role avoid jointly
 * overspending the budget; the hold is reconciled to the actual cost after the run completes.
 */
export function estimateRunCostCents(
  budgetCentsRemaining: number,
  model: string = DEFAULT_MODEL,
): number {
  const tokens = affordableMaxTokens(model, budgetCentsRemaining, 16000)
  const perToken = priceFor(model).output / 1_000_000
  return Math.max(1, Math.ceil(tokens * perToken))
}
