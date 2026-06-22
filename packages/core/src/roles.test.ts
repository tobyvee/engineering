import { describe, expect, it } from "vitest"
import { ROLE_IDS, ROLES } from "./roles"

describe("roles", () => {
  it("defines all seven personas", () => {
    expect(ROLE_IDS).toHaveLength(7)
  })

  it("every role has a positive budget and at least one tool", () => {
    for (const role of Object.values(ROLES)) {
      expect(role.monthlyBudgetCents).toBeGreaterThan(0)
      expect(role.tools.length).toBeGreaterThan(0)
    }
  })

  it("keys its record by the persona id", () => {
    for (const [key, role] of Object.entries(ROLES)) {
      expect(role.id).toBe(key)
    }
  })
})
