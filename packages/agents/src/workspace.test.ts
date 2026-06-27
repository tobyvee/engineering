import { afterEach, describe, expect, it } from "vitest"
import { repoWorkspacePath, resolveCodeWorkspaceRoot } from "./workspace"

describe("resolveCodeWorkspaceRoot", () => {
  const prev = process.env.AGENT_CODE_WORKSPACE
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENT_CODE_WORKSPACE
    else process.env.AGENT_CODE_WORKSPACE = prev
  })

  it("honors AGENT_CODE_WORKSPACE", () => {
    expect(resolveCodeWorkspaceRoot({ AGENT_CODE_WORKSPACE: "/tmp/code-ws" })).toBe("/tmp/code-ws")
  })

  it("defaults to a top-level workspace/ (singular, distinct from throwaway workspaces/)", () => {
    const root = resolveCodeWorkspaceRoot({})
    expect(root.endsWith("/workspace")).toBe(true)
    expect(root.endsWith("/workspaces")).toBe(false)
  })
})

describe("repoWorkspacePath", () => {
  it("lays out clones as <root>/<owner>/<repo>", () => {
    expect(repoWorkspacePath("acme", "widget", { AGENT_CODE_WORKSPACE: "/code" })).toBe(
      "/code/acme/widget",
    )
  })
})
