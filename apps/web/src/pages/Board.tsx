import { useQuery } from "@tanstack/react-query"
import { api } from "../api"

export function Board() {
  const { data, isLoading, error } = useQuery({ queryKey: ["tickets"], queryFn: api.tickets })

  if (isLoading) return <p className="muted">Loading…</p>
  if (error) return <p className="error">Failed to load tickets: {String(error)}</p>

  const tickets = data ?? []
  return (
    <section>
      <h1>Board</h1>
      {tickets.length === 0 ? (
        <p className="muted">
          No tickets yet. The read-view is wired; tickets appear once the orchestrator runs.
        </p>
      ) : (
        <ul>
          {tickets.map((t) => (
            <li key={t.id}>
              <strong>{t.title}</strong> — {t.status} · {t.stage}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
