import { describe, expect, it } from "vitest"
import { PROPOSAL_SCHEMA, TICKETS_SCHEMA, VERDICT_SCHEMA } from "./schemas"

describe("structured-output schemas", () => {
  it("PROPOSAL_SCHEMA requires summary + files and forbids extra props", () => {
    expect(PROPOSAL_SCHEMA.type).toBe("object")
    expect(PROPOSAL_SCHEMA.additionalProperties).toBe(false)
    expect(PROPOSAL_SCHEMA.required).toEqual(["summary", "files"])
  })

  it("TICKETS_SCHEMA constrains assigneeRole to the known roles", () => {
    const props = TICKETS_SCHEMA.properties as {
      tickets: { items: { properties: { assigneeRole: { enum: string[] } } } }
    }
    const role = props.tickets.items.properties.assigneeRole
    expect(role.enum).toContain("staff_engineer")
    expect(role.enum).toContain("pm")
    expect(role.enum).toContain("qa_test")
  })

  it("VERDICT_SCHEMA requires passed + summary", () => {
    expect(VERDICT_SCHEMA.type).toBe("object")
    expect(VERDICT_SCHEMA.required).toEqual(["passed", "summary"])
  })
})
