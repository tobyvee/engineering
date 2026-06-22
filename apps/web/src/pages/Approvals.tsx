import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../api"

export function Approvals() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ["approvals"],
    queryFn: api.approvals,
    refetchInterval: 1500,
  })
  const approve = useMutation({
    mutationFn: (epicId: string) => api.approveRoadmap(epicId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] })
      qc.invalidateQueries({ queryKey: ["tickets"] })
    },
  })

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
            <li key={a.epicId} className="ticket">
              <div>
                <strong>Roadmap sign-off</strong>{" "}
                <span className="muted">· epic {a.epicId.slice(0, 8)}</span>
              </div>
              <div className="actions">
                <button
                  className="btn approve"
                  type="button"
                  onClick={() => approve.mutate(a.epicId)}
                  disabled={approve.isPending}
                >
                  Approve
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
