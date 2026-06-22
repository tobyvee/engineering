import { useQuery } from "@tanstack/react-query"
import { api } from "../api"

export function Approvals() {
  const { data, isLoading, error } = useQuery({ queryKey: ["approvals"], queryFn: api.approvals })

  if (isLoading) return <p className="muted">Loading…</p>
  if (error) return <p className="error">Failed to load approvals: {String(error)}</p>

  const approvals = data ?? []
  return (
    <section>
      <h1>Approvals</h1>
      {approvals.length === 0 ? (
        <p className="muted">No pending approvals. Gates appear here for the lead to sign off.</p>
      ) : (
        <ul>
          {approvals.map((a) => (
            <li key={a.id}>
              <strong>{a.kind}</strong> — {a.status}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
