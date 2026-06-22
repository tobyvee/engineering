import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../api"

export function Board() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ["tickets"],
    queryFn: api.tickets,
    refetchInterval: 1500,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tickets"] })
  const create = useMutation({
    mutationFn: () => api.createTicket("Demo ticket"),
    onSuccess: invalidate,
  })
  const start = useMutation({
    mutationFn: (id: string) => api.startTicket(id),
    onSuccess: invalidate,
  })
  const approve = useMutation({
    mutationFn: (id: string) => api.approveTicket(id),
    onSuccess: invalidate,
  })

  if (isLoading) return <p className="muted">Loading…</p>
  if (error) return <p className="error">Failed to load tickets: {String(error)}</p>

  const tickets = data ?? []
  return (
    <section>
      <div className="row">
        <h1>Board</h1>
        <button
          className="btn"
          type="button"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          New demo ticket
        </button>
      </div>
      {tickets.length === 0 ? (
        <p className="muted">No tickets yet — create one to start a durable lifecycle.</p>
      ) : (
        <ul>
          {tickets.map((t) => (
            <li key={t.id} className="ticket">
              <div>
                <strong>{t.title}</strong> <span className="badge">{t.status}</span>
                <span className="muted"> · {t.stage}</span>
              </div>
              <div className="actions">
                {(t.status === "backlog" || t.status === "planned") && (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => start.mutate(t.id)}
                    disabled={start.isPending}
                  >
                    Start
                  </button>
                )}
                {t.status === "in_review" && (
                  <button
                    className="btn approve"
                    type="button"
                    onClick={() => approve.mutate(t.id)}
                    disabled={approve.isPending}
                  >
                    Approve
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
