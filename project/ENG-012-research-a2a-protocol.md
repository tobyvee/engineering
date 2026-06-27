# ENG-012 — Research Google's A2A (Agent-to-Agent) protocol

- **Status:** done (findings + recommendation recorded below)
- **Priority:** P2 (Medium — discovery spike, decision-oriented)
- **Stage:** discovery
- **Assignee role:** lead_architect
- **Area:** architecture (cross-cutting)

## Findings & recommendation (Wave 0 spike)

**What A2A is (verified, June 2026).** Google's Agent2Agent protocol (announced Apr 2025; donated to
the **Linux Foundation** Jun 2025; **v1.0 early 2026**, 150+ orgs) is an open standard for *agent↔agent*
interoperability: agents from different vendors/frameworks **discover** each other via an **Agent Card**
(a signed JSON document at `/.well-known/agent.json` describing skills, auth, endpoints), then
**delegate tasks** and exchange **messages/artifacts** over JSON-RPC/HTTP with SSE streaming. v1.0's
headline addition is **signed Agent Cards** (cryptographic issuer verification).

**A2A vs MCP.** They are complementary, not competing: **MCP is vertical** (an agent → tools/data —
Anthropic's protocol, Claude-native), **A2A is horizontal** (agent ↔ agent coordination). Industry
guidance: a single agent with tools needs only MCP; networked *multi-vendor* multi-agent systems use
both, "MCP first."

**Fit for this project.** The decisive point: this unit's multi-agent coordination is **intra-unit and
already solved** — the seven roles are stages in a *durable Temporal state machine*, handed artifacts
stage-to-stage behind the `Worker` interface, with human gates and an append-only audit log. That is
stronger than networked peer messaging (durable, gated, traceable). **A2A solves a problem the project
does not currently have internally**, and pulling a vendor-neutral peer-messaging transport into the
core would cut against the deliberate Claude-first / no-provider-agnostic-orchestrator stance (the same
reasoning that rejected LangChain) — unless it's confined to the *edge*.

A2A is only relevant at the unit's **boundary**, in two future directions:
- **Expose** — publish the unit (or individual roles) as A2A-discoverable agents (signed Agent Card),
  so external orgs/frameworks can delegate work to this unit.
- **Consume** — treat an external A2A agent as extra "headcount" behind the `Worker` interface.

**Recommendation: decline now; monitor; keep the boundary port-shaped.**
- **Do not adopt A2A for the internal lifecycle** — Temporal + `Worker` + staged handoff already do this
  better; A2A would be redundant and stance-violating internally.
- **Monitor the spec** — LF-governed, v1.0, 150+ orgs: it is the emerging interop standard, worth
  tracking, but adoption is not justified for a single self-contained unit today.
- **If cross-org / cross-framework interop becomes a goal**, add it *behind a port* (an A2A adapter
  implementing `Worker` for *consume*; an A2A server exposing signed Agent Cards for *expose*), keeping
  `core` framework-agnostic (invariant #5) — never in the orchestration loop.
- **MCP is the higher-value near-term interop bet** for a Claude-first project: if agents should reach
  external *tools*, MCP (vertical, Claude-native) beats A2A (horizontal) for this project's current
  shape. Consider an MCP spike before an A2A one.

### Sources
- A2A overview / Linux Foundation / Agent Card — https://www.ibm.com/think/topics/agent2agent-protocol
- A2A growth + v1.0 signed Agent Cards — https://stellagent.ai/insights/a2a-protocol-google-agent-to-agent
- A2A vs MCP (vertical vs horizontal; "MCP first") — https://onereach.ai/blog/guide-choosing-mcp-vs-a2a-protocols/

## Problem

Evaluate Google's **A2A (Agent-to-Agent) protocol** and determine whether it is appropriate to adopt
in this project, and if so where. A2A is an open protocol (introduced by Google in 2025, subsequently
moved to open governance under the Linux Foundation) for interoperability *between* agents — capability
discovery, task delegation, and message/artifact exchange across agents that may be built on different
frameworks or vendors. This is distinct from MCP, which standardizes an agent's access to *tools and
context*. The goal of this ticket is a clear, evidence-based recommendation — not a commitment to adopt.

> Treat the description above as background to verify, not settled fact. Confirm the current spec
> version, governance, and shape from primary sources as part of this spike.

## Why it matters here (project context)

This system already models a unit's "headcount" as seven role personas behind a uniform `Worker`
interface, orchestrated durably by Temporal, with delivery behind a `DeliveryAdapter`. A2A is
potentially relevant in two directions:

1. **Expose** — present each role agent (PM, Architect, Staff Eng, QA, …) as an A2A-discoverable agent
   (via an Agent Card), so external agents or other frameworks could interoperate with this unit.
2. **Consume** — let the unit delegate to external A2A agents as additional, vendor-neutral
   "headcount" behind the existing orchestration.

There is also a **design-tension to examine head-on:** this project is deliberately Claude-first and
explicitly rejected provider-agnostic orchestration abstractions (e.g. LangChain) to avoid a
vendor-neutral layer through the middle of the product. A2A is intentionally vendor-neutral, so the
spike must judge whether adopting it conflicts with that decision or complements it (e.g. as an
*edge* interop protocol rather than the internal orchestration model).

## Research questions

- What problem does A2A actually solve, and how does it differ from / compose with MCP?
- Core concepts and wire format: Agent Cards / capability discovery, tasks vs. messages vs. artifacts,
  transport (HTTP/JSON-RPC), streaming (e.g. SSE), and authentication model. Confirm current versions.
- Governance, maturity, ecosystem, and SDK/library support (especially TypeScript/Node).
- Security model: authN/authZ between agents, trust boundaries, and how it would interact with this
  project's approval gates, budgets, and append-only audit log.
- Where (if anywhere) it maps onto our seams: `Worker`, the role personas (roles-as-config,
  invariant #6), Temporal orchestration, `DeliveryAdapter`. Does it sit at the *edge* (interop) or
  would it intrude on `core` (which must stay framework-agnostic, invariant #5)?
- Does it conflict with the Claude-first / no-provider-agnostic-orchestrator stance, or is it
  orthogonal (interop at the boundary, not the internal loop)?

## Proposed approach

- Read primary sources (spec + reference implementations/SDKs); build a minimal proof-of-concept only
  if cheap and clarifying (e.g. an Agent Card for one role behind a feature flag).
- Produce a short ADR-style recommendation: adopt / adopt-narrowly / defer / decline, with rationale,
  a candidate integration seam, and a rough effort estimate.

## Acceptance criteria

- [ ] A written findings doc / ADR in `docs/` summarizing A2A, its fit, and the MCP relationship.
- [ ] An explicit recommendation (adopt / adopt-narrowly / defer / decline) with reasoning tied to
      this project's invariants and the Claude-first decision.
- [ ] If "adopt"/"adopt-narrowly": the specific integration seam (expose vs. consume), a proposed
      interface boundary that keeps `core` framework-agnostic, and a follow-up implementation ticket.
- [ ] Primary-source citations and the spec version reviewed.

## Notes / risks

- Time-box the spike; the deliverable is a decision, not an implementation.
- Keep any A2A surface at the boundary — do not let a vendor-neutral abstraction leak into `core`.
