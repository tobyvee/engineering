/**
 * Inter-rater agreement coefficients (ENG-016 / PRD-001), corrected for chance. Pure functions over
 * plain numeric matrices so they're trivially unit-testable and free of any schema/agent coupling.
 *
 * Honest caveat (PRD): with only ~3 raters and a few candidates these coefficients are *noisy* — a
 * single flipped vote swings them. They are used as a confidence signal feeding a decision rule, not
 * as a hard statistical inference. Degenerate cases (no variation / unanimity) map to 1, never NaN.
 */

export type AgreementMetric = "krippendorff_alpha" | "fleiss_kappa" | "kendall_w"
export type DiffMetric = "nominal" | "ordinal" | "interval"

export interface AgreementResult {
  coefficient: number
  metric: AgreementMetric
}

/**
 * Krippendorff's alpha over a reliability matrix `units × raters` (`null` = a missing rating). The
 * single primary coefficient (PRD): it spans nominal / ordinal / interval data and ≥3 fixed raters,
 * so it need not change between single-pick and ranked input. Returns 1 for perfect agreement
 * (including the degenerate no-variation case) and can go negative for systematic disagreement.
 */
export function krippendorffAlpha(
  matrix: ReadonlyArray<ReadonlyArray<number | null>>,
  metric: DiffMetric = "nominal",
): number {
  const valueSet = new Set<number>()
  for (const unit of matrix) for (const v of unit) if (v != null) valueSet.add(v)
  const levels = [...valueSet].sort((a, b) => a - b)
  if (levels.length <= 1) return 1 // no variation → perfect agreement (degenerate-safe)

  const indexOf = new Map(levels.map((v, i) => [v, i]))
  const L = levels.length
  const o: number[][] = Array.from({ length: L }, () => new Array<number>(L).fill(0))

  for (const unit of matrix) {
    const present: number[] = []
    for (const v of unit) if (v != null) present.push(v)
    const m = present.length
    if (m < 2) continue
    for (let a = 0; a < m; a++) {
      for (let b = 0; b < m; b++) {
        if (a === b) continue
        const c = indexOf.get(present[a] ?? 0) ?? 0
        const k = indexOf.get(present[b] ?? 0) ?? 0
        const row = o[c]
        if (row) row[k] = (row[k] ?? 0) + 1 / (m - 1)
      }
    }
  }

  const nC = o.map((row) => row.reduce((s, x) => s + x, 0))
  const n = nC.reduce((s, x) => s + x, 0)
  if (n < 2) return 1 // nothing pairable → nothing to disagree on

  const delta2 = (c: number, k: number): number => {
    if (c === k) return 0
    if (metric === "nominal") return 1
    if (metric === "interval") return ((levels[c] ?? 0) - (levels[k] ?? 0)) ** 2
    // ordinal: (Σ marginals spanning c..k, less half of each endpoint)²
    const lo = Math.min(c, k)
    const hi = Math.max(c, k)
    let s = 0
    for (let g = lo; g <= hi; g++) s += nC[g] ?? 0
    s -= ((nC[lo] ?? 0) + (nC[hi] ?? 0)) / 2
    return s * s
  }

  let Do = 0
  let De = 0
  for (let c = 0; c < L; c++) {
    for (let k = 0; k < L; k++) {
      const ock = o[c]?.[k] ?? 0
      const d = delta2(c, k)
      Do += ock * d
      De += (nC[c] ?? 0) * (nC[k] ?? 0) * d
    }
  }
  Do /= n
  De /= n * (n - 1)
  if (De === 0) return 1 // no expected disagreement → perfect (degenerate-safe)
  return 1 - Do / De
}

/**
 * Fleiss' kappa for single-pick agreement (PRD): subjects = candidates, categories = {selected, not},
 * `n` raters each selecting exactly one candidate. (Light's kappa — the mean pairwise Cohen's — is the
 * more principled measure for fixed raters but ≈ Fleiss' in practice; Fleiss' is the pragmatic
 * stand-in.) `picks[r]` is the candidate index rater r chose. Unanimity → 1; degenerate-safe.
 */
export function fleissKappa(picks: ReadonlyArray<number>, candidateCount: number): number {
  const n = picks.length
  if (n < 2 || candidateCount < 2) return 1
  const votes = new Array<number>(candidateCount).fill(0)
  for (const p of picks) if (p >= 0 && p < candidateCount) votes[p] = (votes[p] ?? 0) + 1

  let pBar = 0
  for (let i = 0; i < candidateCount; i++) {
    const v = votes[i] ?? 0
    pBar += (v * v + (n - v) * (n - v) - n) / (n * (n - 1))
  }
  pBar /= candidateCount

  const pSelected = 1 / candidateCount // each rater picks one of `candidateCount`
  const pNot = 1 - pSelected
  const pE = pSelected * pSelected + pNot * pNot
  if (pE >= 1) return 1
  return (pBar - pE) / (1 - pE)
}

/**
 * Kendall's W (coefficient of concordance) for ranked agreement (PRD): `m` raters each producing a
 * strict ranking over `n` items. `rankings[r][i]` is the rank rater r gave item i (1 = best). Returns
 * W in [0,1] — 1 = perfect concordance, 0 = none. Degenerate-safe (n < 2 → 1).
 */
export function kendallW(rankings: ReadonlyArray<ReadonlyArray<number>>): number {
  const m = rankings.length
  if (m === 0) return 1
  const n = rankings[0]?.length ?? 0
  if (n < 2) return 1

  const rankSum = new Array<number>(n).fill(0)
  for (const r of rankings) for (let i = 0; i < n; i++) rankSum[i] = (rankSum[i] ?? 0) + (r[i] ?? 0)

  const rBar = (m * (n + 1)) / 2
  let S = 0
  for (let i = 0; i < n; i++) S += ((rankSum[i] ?? 0) - rBar) ** 2

  const denom = (m * m * (n * n * n - n)) / 12
  if (denom === 0) return 1
  return S / denom
}

/**
 * The primary agreement coefficient for a consensus round: Krippendorff's alpha over the selection
 * matrix (nominal, single-pick) or the rank matrix (ordinal, ranked). Both are `candidates × raters`.
 */
export function agreement(
  input:
    | { mode: "pick"; selectionMatrix: ReadonlyArray<ReadonlyArray<number | null>> }
    | { mode: "rank"; rankMatrix: ReadonlyArray<ReadonlyArray<number | null>> },
): AgreementResult {
  const coefficient =
    input.mode === "pick"
      ? krippendorffAlpha(input.selectionMatrix, "nominal")
      : krippendorffAlpha(input.rankMatrix, "ordinal")
  return { coefficient, metric: "krippendorff_alpha" }
}
