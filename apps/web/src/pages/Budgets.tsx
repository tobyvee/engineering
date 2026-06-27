import { useQuery } from "@tanstack/react-query"
import { api } from "../api"

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** Per-role budget/cost view for the accountable lead (ENG-010). */
export function Budgets() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["budgets"],
    queryFn: api.budgets,
    refetchInterval: 3000,
  })

  if (isLoading) return <p className="muted">Loading…</p>
  if (error) return <p className="error">Failed to load budgets: {String(error)}</p>

  const budgets = data ?? []
  const total = budgets.reduce(
    (acc, b) => ({ limit: acc.limit + b.limitCents, spent: acc.spent + b.spentCents }),
    { limit: 0, spent: 0 },
  )

  return (
    <section>
      <h1>Budgets</h1>
      {budgets.length === 0 ? (
        <p className="muted">No budgets seeded yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Scope</th>
              <th>Limit</th>
              <th>Spent</th>
              <th>Remaining</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((b) => (
              <tr key={b.scope}>
                <td>{b.scope}</td>
                <td>{dollars(b.limitCents)}</td>
                <td>{dollars(b.spentCents)}</td>
                <td>{dollars(b.remainingCents)}</td>
              </tr>
            ))}
            <tr>
              <td>
                <strong>Total</strong>
              </td>
              <td>{dollars(total.limit)}</td>
              <td>{dollars(total.spent)}</td>
              <td>{dollars(Math.max(0, total.limit - total.spent))}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  )
}
