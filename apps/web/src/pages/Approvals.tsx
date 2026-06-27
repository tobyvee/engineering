import type { Approval } from "@eng/core"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "../api"

const LABELS: Record<string, string> = {
  roadmap: "Roadmap sign-off",
  pr_merge: "Merge",
  deploy: "Deploy",
  design_signoff: "Design sign-off",
  architecture_decision: "Architecture decision",
}

/** Dispatch the right approve call for a pending gate (ENG-006: roadmap · merge · deploy). */
function decide(a: Approval): Promise<unknown> {
  if (a.kind === "roadmap" && a.epicId) return api.approveRoadmap(a.epicId)
  if (a.kind === "pr_merge" && a.ticketId) return api.approve(a.ticketId, "merge")
  if (a.kind === "deploy" && a.ticketId) return api.approve(a.ticketId, "deploy")
  return Promise.resolve()
}

export function Approvals() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ["approvals"],
    queryFn: api.approvals,
    refetchInterval: 1500,
  })
  const approve = useMutation({
    mutationFn: decide,
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
            <li key={a.id} className="ticket">
              <div>
                <strong>{LABELS[a.kind] ?? a.kind}</strong>{" "}
                <span className="muted">
                  ·{" "}
                  {a.ticketId
                    ? `ticket ${a.ticketId.slice(0, 8)}`
                    : a.epicId
                      ? `epic ${a.epicId.slice(0, 8)}`
                      : ""}
                </span>
              </div>
              <div className="actions">
                <button
                  className="btn approve"
                  type="button"
                  onClick={() => approve.mutate(a)}
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
