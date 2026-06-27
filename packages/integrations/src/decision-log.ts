import type { Decision, DecisionLog, KnowledgeBase, NewDecision, WorkItemRef } from "@eng/core"

/**
 * The hybrid decision log (ENG-014): an **index** backend (e.g. Postgres) holds the queryable,
 * integrity-checked node + edges; this decorator additionally writes each decision as a
 * human-readable Markdown **body** to a `KnowledgeBase`. On the GitHub KB those bodies are real files
 * in the repo — PR-reviewable next to the code — while reads/traversal stay on the fast, structured
 * index. Reads delegate to the index; only `record` fans out to the body store.
 */
export class KnowledgeBackedDecisionLog implements DecisionLog {
  constructor(
    private readonly index: DecisionLog,
    private readonly knowledge: KnowledgeBase,
    private readonly prefix = "decisions",
  ) {}

  async record(decision: NewDecision): Promise<Decision> {
    const recorded = await this.index.record(decision)
    // Best-effort body write — the index is the system of record, so a KB hiccup must not lose the
    // decision. (The append-only index row already succeeded above.)
    try {
      await this.knowledge.write(`${this.prefix}/${recorded.id}.md`, renderDecisionDoc(recorded))
    } catch {
      // body is a convenience view; swallow and keep the indexed decision
    }
    return recorded
  }

  get(id: string): Promise<Decision | null> {
    return this.index.get(id)
  }

  listByRoot(rootRequestId: string): Promise<Decision[]> {
    return this.index.listByRoot(rootRequestId)
  }

  byWorkItem(ref: WorkItemRef): Promise<Decision[]> {
    return this.index.byWorkItem(ref)
  }

  traverseToRoot(id: string): Promise<Decision[]> {
    return this.index.traverseToRoot(id)
  }
}

/** Render a decision as a PR-reviewable Markdown doc (frontmatter for the refs, prose for the body). */
export function renderDecisionDoc(d: Decision): string {
  const refs = [
    ["root", d.rootRequestId],
    ["parents", d.parentDecisionIds.join(", ") || "—"],
    ["mission", d.missionId ?? "—"],
    ["goal", d.goalId ?? "—"],
    ["epic", d.epicId ?? "—"],
    ["ticket", d.ticketId ?? "—"],
    ["actor", d.actor],
    ["stage", d.stage],
    ["audit_event", d.auditEventId ?? "—"],
    ["confidence", d.confidence == null ? "—" : d.confidence.toFixed(2)],
    ["cost_cents", d.costCents == null ? "—" : d.costCents.toFixed(4)],
    ["at", d.at],
  ]
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")

  const alternatives = d.alternatives.length
    ? d.alternatives.map((a) => `- **${a.option}** — rejected: ${a.rejectedBecause}`).join("\n")
    : "_none recorded_"
  const inputs = d.inputs.length ? d.inputs.map((i) => `- ${i}`).join("\n") : "_none_"
  const outputs = d.outputs.length ? d.outputs.map((o) => `- ${o}`).join("\n") : "_none_"

  return [
    `# Decision ${d.id}`,
    "",
    "```yaml",
    refs,
    "```",
    "",
    "## Decision",
    "",
    d.statement,
    "",
    "## Rationale",
    "",
    d.rationale || "_none recorded_",
    "",
    "## Alternatives considered",
    "",
    alternatives,
    "",
    "## Inputs",
    "",
    inputs,
    "",
    "## Outputs",
    "",
    outputs,
    "",
  ].join("\n")
}
