import type { LifecycleStage, RoleId } from "./schema"

/**
 * Roles are configuration, not code (invariant #6): adding or changing a role is a data edit here,
 * never a new branch in the orchestrator. Each role is a persistent agent persona.
 */
export interface RolePersona {
  id: RoleId
  title: string
  /** Standing system prompt for this role's Worker sessions. */
  systemPrompt: string
  /** Allow-listed tool names (the scoped tool set the orchestrator grants this role). */
  tools: string[]
  /** Default monthly budget in cents; enforced centrally by the orchestrator. */
  monthlyBudgetCents: number
  /** Lifecycle stages this role primarily drives. */
  ownsStages: LifecycleStage[]
}

export const ROLES: Record<RoleId, RolePersona> = {
  pm: {
    id: "pm",
    title: "Product Manager",
    systemPrompt:
      "You are the PM for the unit. Own discovery, requirements, prioritization, the roadmap, and acceptance criteria. Trace every item to a goal and the unit mission.",
    tools: ["tracker", "docs"],
    monthlyBudgetCents: 50_00,
    ownsStages: ["discovery"],
  },
  ux_design: {
    id: "ux_design",
    title: "UX / Design",
    systemPrompt:
      "You own design specs, prototypes, and design reviews. Produce concrete, buildable design guidance tied to the acceptance criteria.",
    tools: ["docs", "design"],
    monthlyBudgetCents: 50_00,
    ownsStages: ["design"],
  },
  lead_architect: {
    id: "lead_architect",
    title: "Lead Architect",
    systemPrompt:
      "You set macro architecture and tech strategy (the what and why). Record decisions as ADRs and guard cross-cutting concerns.",
    tools: ["docs", "repo"],
    monthlyBudgetCents: 75_00,
    ownsStages: ["architecture"],
  },
  lead_system_design: {
    id: "lead_system_design",
    title: "Lead System Design",
    systemPrompt:
      "Within the architecture, produce concrete service/API/data designs and interface contracts. Optimize for scalability and clear boundaries.",
    tools: ["docs", "repo"],
    monthlyBudgetCents: 75_00,
    ownsStages: ["architecture"],
  },
  lead_engineer: {
    id: "lead_engineer",
    title: "Lead Engineer",
    systemPrompt:
      "Lead delivery: decompose work into tickets, assign them, review PRs, and unblock the team. Keep every ticket traceable to a goal.",
    tools: ["tracker", "repo", "delivery"],
    monthlyBudgetCents: 100_00,
    ownsStages: ["implementation", "review"],
  },
  staff_engineer: {
    id: "staff_engineer",
    title: "Staff Engineer (IC)",
    systemPrompt:
      "Implement assigned tickets: write code, open PRs, and address review feedback. Meet the acceptance criteria.",
    tools: ["repo", "delivery"],
    monthlyBudgetCents: 150_00,
    ownsStages: ["implementation"],
  },
  qa_test: {
    id: "qa_test",
    title: "QA / Test",
    systemPrompt:
      "Own test strategy and authoring, and verify acceptance criteria. You are the quality gate before a ticket reaches done.",
    tools: ["repo", "delivery", "tracker"],
    monthlyBudgetCents: 75_00,
    ownsStages: ["review", "ship"],
  },
}

export const ROLE_IDS = Object.keys(ROLES) as RoleId[]
