import type { HierarchyNode } from "@eng/core"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { api } from "../api"

/** One goal with its epics + an inline form to author another epic under it. */
function GoalCard({ goal }: { goal: HierarchyNode }) {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ["epics", goal.id], queryFn: () => api.epics(goal.id) })
  const [title, setTitle] = useState("")
  const addEpic = useMutation({
    mutationFn: () => api.createEpic(title.trim(), goal.id),
    onSuccess: () => {
      setTitle("")
      qc.invalidateQueries({ queryKey: ["epics", goal.id] })
      qc.invalidateQueries({ queryKey: ["epics"] })
    },
  })

  const epics = data ?? []
  return (
    <li>
      <strong>{goal.title}</strong>{" "}
      <span className="muted">
        · {epics.length} epic{epics.length === 1 ? "" : "s"}
      </span>
      {epics.length > 0 && (
        <ul className="sub">
          {epics.map((e) => (
            <li key={e.id}>{e.title}</li>
          ))}
        </ul>
      )}
      <form
        className="form sub-form"
        onSubmit={(ev) => {
          ev.preventDefault()
          if (title.trim()) addEpic.mutate()
        }}
      >
        <input
          className="input"
          placeholder="New epic…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn" type="submit" disabled={addEpic.isPending || !title.trim()}>
          Add epic
        </button>
      </form>
    </li>
  )
}

export function Roadmap() {
  const qc = useQueryClient()
  const { data, isLoading, error } = useQuery({ queryKey: ["goals"], queryFn: api.goals })
  const [title, setTitle] = useState("")
  const addGoal = useMutation({
    mutationFn: () => api.createGoal(title.trim()),
    onSuccess: () => {
      setTitle("")
      qc.invalidateQueries({ queryKey: ["goals"] })
    },
  })

  if (isLoading) return <p className="muted">Loading…</p>
  if (error) return <p className="error">Failed to load roadmap: {String(error)}</p>

  const goals = data ?? []
  return (
    <section>
      <h1>Roadmap</h1>
      <p className="muted">
        Mission → Goal → Epic → Ticket. Author goals and epics here; tickets target an epic on the
        Board.
      </p>
      <form
        className="form"
        onSubmit={(ev) => {
          ev.preventDefault()
          if (title.trim()) addGoal.mutate()
        }}
      >
        <input
          className="input"
          placeholder="New goal…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="btn" type="submit" disabled={addGoal.isPending || !title.trim()}>
          Add goal
        </button>
      </form>
      {goals.length === 0 ? (
        <p className="muted">No goals yet — add one to structure the roadmap.</p>
      ) : (
        <ul>
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </ul>
      )}
    </section>
  )
}
