import { ROLE_IDS } from "@eng/core"

/**
 * JSON Schemas for agent structured outputs (ENG-009). Hand-written (rather than zod-derived) to stay
 * within the API's structured-output constraints — every object sets `additionalProperties: false`
 * and lists `required`, and no unsupported keywords (min/max length, etc.) are used. Passed to the
 * Worker as `outputSchema`; the API backend enforces them, the CLI backend falls back to parsing.
 */

/** `{ summary, files: [{ path, content }] }` — the coding agent's file changes. */
export const PROPOSAL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "files"],
  properties: {
    summary: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
      },
    },
  },
}

/** `{ tickets: [{ title, description, acceptanceCriteria, assigneeRole }] }` — epic decomposition. */
export const TICKETS_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["tickets"],
  properties: {
    tickets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "acceptanceCriteria", "assigneeRole"],
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
          assigneeRole: { type: "string", enum: [...ROLE_IDS] },
        },
      },
    },
  },
}

/** `{ passed, summary }` — the QA verdict. */
export const VERDICT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["passed", "summary"],
  properties: {
    passed: { type: "boolean" },
    summary: { type: "string" },
  },
}
