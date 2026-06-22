import { useQuery } from "@tanstack/react-query"
import { api } from "../api"

export function Audit() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["audit"],
    queryFn: api.audit,
    refetchInterval: 1500,
  })

  if (isLoading) return <p className="muted">Loading…</p>
  if (error) return <p className="error">Failed to load audit log: {String(error)}</p>

  const events = data ?? []
  return (
    <section>
      <h1>Audit</h1>
      {events.length === 0 ? (
        <p className="muted">No audit events yet. This is a read view over the append-only log.</p>
      ) : (
        <ul>
          {events.map((e) => (
            <li key={e.id}>
              <span className="muted">{new Date(e.at).toLocaleTimeString()}</span> · {e.actor} ·{" "}
              <strong>{e.kind}</strong>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
