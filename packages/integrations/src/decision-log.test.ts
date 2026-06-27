import {
  type Decision,
  type DecisionLog,
  type KnowledgeBase,
  type NewDecision,
  traceToRoot,
  type WorkItemRef,
} from "@eng/core"
import { describe, expect, it } from "vitest"
import { KnowledgeBackedDecisionLog, renderDecisionDoc } from "./decision-log"

/** In-memory DecisionLog index for testing the decorator (no DB). */
class MemoryIndex implements DecisionLog {
  private readonly store = new Map<string, Decision>()
  private seq = 0

  async record(d: NewDecision): Promise<Decision> {
    const id = `d${++this.seq}`
    const decision: Decision = { ...d, id, at: `2026-06-27T00:00:0${this.seq}.000Z` }
    this.store.set(id, decision)
    return decision
  }
  async get(id: string) {
    return this.store.get(id) ?? null
  }
  async listByRoot(rootRequestId: string) {
    return [...this.store.values()].filter((d) => d.rootRequestId === rootRequestId)
  }
  async byWorkItem(ref: WorkItemRef) {
    return [...this.store.values()].filter(
      (d) =>
        (!ref.ticketId || d.ticketId === ref.ticketId) && (!ref.epicId || d.epicId === ref.epicId),
    )
  }
  async traverseToRoot(id: string) {
    return traceToRoot(id, this.store)
  }
}

/** In-memory KnowledgeBase. */
class MemoryKB implements KnowledgeBase {
  readonly docs = new Map<string, string>()
  async read(path: string) {
    return this.docs.get(path) ?? null
  }
  async write(path: string, content: string) {
    this.docs.set(path, content)
  }
  async list(prefix?: string) {
    return [...this.docs.keys()].filter((p) => !prefix || p.startsWith(prefix))
  }
}

const newDecision = (over: Partial<NewDecision> = {}): NewDecision => ({
  rootRequestId: "epic-1",
  parentDecisionIds: [],
  missionId: null,
  goalId: null,
  epicId: "epic-1",
  ticketId: null,
  actor: "lead_architect",
  stage: "architecture",
  statement: "Adopt the layered adapter design",
  rationale: "keeps core backend-agnostic",
  alternatives: [{ option: "direct SDK calls", rejectedBecause: "couples core to a vendor" }],
  inputs: ["epics/epic-1/discovery.md"],
  outputs: ["epics/epic-1/architecture.md"],
  confidence: 0.8,
  costCents: 1.23,
  auditEventId: "audit-1",
  ...over,
})

describe("KnowledgeBackedDecisionLog", () => {
  it("records to the index and writes a human-readable body to the KB", async () => {
    const index = new MemoryIndex()
    const kb = new MemoryKB()
    const log = new KnowledgeBackedDecisionLog(index, kb)

    const d = await log.record(newDecision())
    // indexed
    expect(await log.get(d.id)).toEqual(d)
    // body written to the KB, PR-reviewable, with the key content
    const body = await kb.read(`decisions/${d.id}.md`)
    expect(body).toContain("Adopt the layered adapter design")
    expect(body).toContain("direct SDK calls")
    expect(body).toContain("epics/epic-1/architecture.md")
  })

  it("delegates reads/traversal to the index across a chain", async () => {
    const index = new MemoryIndex()
    const log = new KnowledgeBackedDecisionLog(index, new MemoryKB())

    const root = await log.record(newDecision({ parentDecisionIds: [], actor: "human" }))
    const mid = await log.record(newDecision({ parentDecisionIds: [root.id] }))
    const leaf = await log.record(newDecision({ parentDecisionIds: [mid.id], ticketId: "t-1" }))

    expect((await log.listByRoot("epic-1")).map((d) => d.id).sort()).toEqual(
      [root.id, mid.id, leaf.id].sort(),
    )
    expect((await log.byWorkItem({ ticketId: "t-1" })).map((d) => d.id)).toEqual([leaf.id])
    expect((await log.traverseToRoot(leaf.id)).map((d) => d.id)).toEqual([leaf.id, mid.id, root.id])
  })

  it("still returns the indexed decision when the KB body write fails", async () => {
    const index = new MemoryIndex()
    const failingKb: KnowledgeBase = {
      read: async () => null,
      write: async () => {
        throw new Error("KB down")
      },
      list: async () => [],
    }
    const log = new KnowledgeBackedDecisionLog(index, failingKb)
    const d = await log.record(newDecision())
    expect(await log.get(d.id)).toEqual(d) // index is the system of record
  })
})

describe("renderDecisionDoc", () => {
  it("includes refs, decision, rationale, alternatives, inputs and outputs", () => {
    const d: Decision = { ...newDecision(), id: "d1", at: "2026-06-27T00:00:00.000Z" }
    const md = renderDecisionDoc(d)
    expect(md).toContain("# Decision d1")
    expect(md).toContain("root: epic-1")
    expect(md).toContain("## Rationale")
    expect(md).toContain("keeps core backend-agnostic")
    expect(md).toContain("- **direct SDK calls** — rejected: couples core to a vendor")
  })
})
