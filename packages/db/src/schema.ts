import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"

/**
 * Postgres schema mirroring `@eng/core`. Goal traceability (invariant #1) is enforced at the DB
 * level too: every child row carries a NOT NULL foreign key up the hierarchy
 * (ticket → epic → goal → mission → unit).
 */

export const ticketStatus = pgEnum("ticket_status", [
  "backlog",
  "planned",
  "in_progress",
  "in_review",
  "deploying",
  "blocked",
  "done",
])

export const lifecycleStage = pgEnum("lifecycle_stage", [
  "discovery",
  "design",
  "architecture",
  "implementation",
  "review",
  "ship",
])

export const roleId = pgEnum("role_id", [
  "pm",
  "ux_design",
  "lead_architect",
  "lead_system_design",
  "lead_engineer",
  "staff_engineer",
  "qa_test",
])

export const approvalKind = pgEnum("approval_kind", [
  "roadmap",
  "design_signoff",
  "architecture_decision",
  "pr_merge",
  "deploy",
])

export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"])

export const units = pgTable("units", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const missions = pgTable("missions", {
  id: uuid("id").primaryKey().defaultRandom(),
  unitId: uuid("unit_id")
    .notNull()
    .references(() => units.id),
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const goals = pgTable("goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  missionId: uuid("mission_id")
    .notNull()
    .references(() => missions.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const epics = pgTable("epics", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id")
    .notNull()
    .references(() => goals.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
})

export const tickets = pgTable("tickets", {
  id: uuid("id").primaryKey().defaultRandom(),
  epicId: uuid("epic_id")
    .notNull()
    .references(() => epics.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: ticketStatus("status").notNull().default("backlog"),
  stage: lifecycleStage("stage").notNull().default("implementation"),
  assigneeRole: roleId("assignee_role"),
  acceptanceCriteria: jsonb("acceptance_criteria").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  unitId: uuid("unit_id")
    .notNull()
    .references(() => units.id),
  scope: text("scope").notNull(), // a role id, or "unit"
  limitCents: integer("limit_cents").notNull(),
  spentCents: integer("spent_cents").notNull().default(0),
})

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: approvalKind("kind").notNull(),
  ticketId: uuid("ticket_id").references(() => tickets.id),
  requestedByRole: roleId("requested_by_role").notNull(),
  status: approvalStatus("status").notNull().default("pending"),
  decidedBy: text("decided_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
})

/** Knowledge base / docs store (the Postgres-backed KnowledgeBase). */
export const kbDocs = pgTable("kb_docs", {
  path: text("path").primaryKey(),
  content: text("content").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

/** Append-only (invariant #2): inserts only, never UPDATE/DELETE. */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actor: text("actor").notNull(),
  kind: text("kind").notNull(),
  ticketId: uuid("ticket_id").references(() => tickets.id),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
})
