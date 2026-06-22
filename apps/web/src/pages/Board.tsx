import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { api } from "../api"

export function Board() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ["tickets"],
    queryFn: api.tickets,
    refetchInterval: 1500,
  })
  const { data: epics } = useQuery({ queryKey: ["epics"], queryFn: () => api.epics() })

  const [title, setTitle] = useState("Demo ticket")
  const [epicId, setEpicId] = useState("")

  const invalidate = () => qc.invalidateQueries({ queryKey: ["tickets"] })
  const create = useMutation({
    mutationFn: () => api.createTicket(title.trim() || "Demo ticket", epicId || undefined),
    onSuccess: invalidate,
  })
  const start = useMutation({
    mutationFn: (id: string) => api.startTicket(id),
    onSuccess: invalidate,
  })
  const approve = useMutation({
    mutationFn: ({ id, gate }: { id: string; gate: "merge" | "deploy" }) => api.approve(id, gate),
    onSuccess: invalidate,
  })

  if (isLoading) return <p className="muted">Loading…</p>
  if (error) return <p className="error">Failed to load tickets: {String(error)}</p>

  const tickets = data ?? []
  const epicTitle = (id: string) => (epics ?? []).find((e) => e.id === id)?.title

  return (
    <section>
      <div className="row">
        <h1>Board</h1>
        <div className="actions">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="Ticket title"
          />
          <select
            className="input"
            value={epicId}
            onChange={(e) => setEpicId(e.target.value)}
            aria-label="Epic"
          >
            <option value="">Default epic</option>
            {(epics ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <button
            className="btn"
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            New ticket
          </button>
        </div>
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
                {epicTitle(t.epicId) && <span className="muted"> · {epicTitle(t.epicId)}</span>}
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
                    onClick={() => approve.mutate({ id: t.id, gate: "merge" })}
                    disabled={approve.isPending}
                  >
                    Approve
                  </button>
                )}
                {t.status === "deploying" && (
                  <button
                    className="btn approve"
                    type="button"
                    onClick={() => approve.mutate({ id: t.id, gate: "deploy" })}
                    disabled={approve.isPending}
                  >
                    Approve deploy
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
