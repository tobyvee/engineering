import { existsSync } from "node:fs"
import { chmod, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CliBackend, createSandbox, resolveWorkspaceRoot, sandboxEnv } from "./cli"

describe("resolveWorkspaceRoot", () => {
  const prev = process.env.AGENT_WORKSPACE_DIR
  afterEach(() => {
    if (prev === undefined) delete process.env.AGENT_WORKSPACE_DIR
    else process.env.AGENT_WORKSPACE_DIR = prev
  })

  it("honors AGENT_WORKSPACE_DIR", () => {
    process.env.AGENT_WORKSPACE_DIR = "/tmp/agent-ws"
    expect(resolveWorkspaceRoot()).toBe("/tmp/agent-ws")
  })

  it("defaults to a top-level workspaces/ directory", () => {
    delete process.env.AGENT_WORKSPACE_DIR
    expect(resolveWorkspaceRoot().endsWith("/workspaces")).toBe(true)
  })
})

describe("createSandbox", () => {
  let root: string
  beforeEach(() => {
    root = join(tmpdir(), `eng-ws-${process.pid}-${Date.now()}`)
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("creates a unique per-run dir under the root, namespaced by role", async () => {
    const a = await createSandbox(root, "pm")
    const b = await createSandbox(root, "pm")
    expect(a.startsWith(root)).toBe(true)
    expect(a).toContain("/pm-")
    expect(existsSync(a)).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe("sandboxEnv", () => {
  it("forwards benign vars but withholds host secrets", () => {
    const env = sandboxEnv({
      PATH: "/usr/bin",
      HOME: "/home/agent",
      ANTHROPIC_API_KEY: "sk-secret",
      GITHUB_TOKEN: "ghp-secret",
      DATABASE_URL: "postgres://secret",
    })
    expect(env.PATH).toBe("/usr/bin")
    expect(env.HOME).toBe("/home/agent")
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
  })

  it("supports opt-in passthrough but never leaks unlisted vars", () => {
    const env = sandboxEnv({
      PATH: "/usr/bin",
      AGENT_SANDBOX_ENV_PASSTHROUGH: "FOO, BAR",
      FOO: "1",
      BAR: "2",
      ANTHROPIC_API_KEY: "sk-secret",
    })
    expect(env.FOO).toBe("1")
    expect(env.BAR).toBe("2")
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it("omits allow-listed vars that are absent from the source", () => {
    const env = sandboxEnv({ PATH: "/usr/bin" })
    expect("HOME" in env).toBe(false)
  })
})

describe("CliBackend sandbox enforcement", () => {
  let root: string
  let bin: string
  beforeEach(async () => {
    root = join(tmpdir(), `eng-ws-${process.pid}-${Date.now()}`)
    await mkdir(root, { recursive: true })
    bin = join(root, "fakebin.sh")
    await writeFile(bin, "#!/bin/sh\npwd\n") // ignores args; prints its cwd
    await chmod(bin, 0o755)
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it("runs the agent with its cwd inside a per-run workspace sandbox, not the repo", async () => {
    const backend = new CliBackend("claude-opus-4-8", { bin, workspaceRoot: root })
    const result = await backend.run({
      role: "pm",
      systemPrompt: "",
      tools: [],
      goalContext: "",
      task: "x",
      budgetCentsRemaining: 100,
    })
    // fakebin prints its cwd (not JSON) → it becomes the summary; it must be a `pm-*` sandbox dir,
    // never the worker's own cwd.
    expect(result.summary).toMatch(/\/pm-[A-Za-z0-9]+$/)
    expect(result.summary).not.toBe(process.cwd())
  })
})
