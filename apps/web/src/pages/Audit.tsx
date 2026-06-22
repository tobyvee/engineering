import { useQuery } from "@tanstack/react-query"
import { api } from "../api"

/** Build a compact, human detail line from an audit event's payload. */
function eventDetail(payload: Record<string, unknown>): { text: string; url?: string } {
  const str = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string) : undefined)
  const num = (k: string) => (typeof payload[k] === "number" ? (payload[k] as number) : undefined)

  const parts: string[] = []
  const push = (v?: string) => {
    if (v) parts.push(v)
  }

  push(str("stage"))
  const status = str("status")
  push(status ? `→ ${status}` : undefined)
  push(str("state"))
  const cost = num("costCents")
  push(cost !== undefined ? `${cost}¢` : undefined)
  const files = num("files")
  push(files !== undefined ? `${files} file${files === 1 ? "" : "s"}` : undefined)
  const sha = str("sha")
  push(sha ? sha.slice(0, 7) : undefined)
  const number = num("number")
  push(number !== undefined ? `PR #${number}` : undefined)
  push(str("reason"))
  push(str("error"))

  return { text: parts.join(" · "), url: str("url") }
}

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
          {events.map((e) => {
            const d = eventDetail(e.payload)
            return (
              <li key={e.id}>
                <span className="muted">{new Date(e.at).toLocaleTimeString()}</span> · {e.actor} ·{" "}
                <strong>{e.kind}</strong>
                {d.text && <span className="muted"> — {d.text}</span>}
                {d.url && (
                  <>
                    {" "}
                    <a className="link" href={d.url} target="_blank" rel="noreferrer">
                      ↗
                    </a>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
