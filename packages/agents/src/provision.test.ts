import { describe, expect, it } from "vitest"
import { ensureRepoCloned, gitArgs, provisionAction, repoTargetFromEnv } from "./provision"

describe("repoTargetFromEnv", () => {
  it("is null when GitHub isn't configured", () => {
    expect(repoTargetFromEnv({})).toBeNull()
    expect(repoTargetFromEnv({ GITHUB_OWNER: "acme" })).toBeNull()
  })

  it("reads owner/repo and prefers the PM-scoped token over the host token", () => {
    expect(
      repoTargetFromEnv({
        GITHUB_OWNER: "acme",
        GITHUB_REPO: "widget",
        GITHUB_TOKEN: "host",
        AGENT_PM_GITHUB_TOKEN: "scoped",
      }),
    ).toEqual({ owner: "acme", repo: "widget", token: "scoped" })
  })
})

describe("provisionAction", () => {
  it("clones a fresh dir and pulls an existing checkout", () => {
    expect(provisionAction("/no/such/dir-xyz")).toBe("clone")
    // The repo root itself has a .git → would be a pull (proves the existsSync branch).
    expect(provisionAction(process.cwd())).toBe("pull")
  })
})

describe("gitArgs", () => {
  it("builds a shallow clone with the auth header (token kept out of config)", () => {
    const args = gitArgs("clone", "/code/acme/widget", {
      owner: "acme",
      repo: "widget",
      token: "t0ken",
    })
    expect(args).toContain("clone")
    expect(args).toContain("--depth")
    expect(args.join(" ")).toContain("https://github.com/acme/widget.git")
    expect(args.join(" ")).toContain("http.extraheader=AUTHORIZATION: bearer t0ken")
  })

  it("builds a ff-only pull for an existing checkout, no auth header when tokenless", () => {
    const args = gitArgs("pull", "/code/acme/widget", { owner: "acme", repo: "widget" })
    expect(args.slice(0, 2)).toEqual(["-C", "/code/acme/widget"])
    expect(args).toContain("pull")
    expect(args).toContain("--ff-only")
    expect(args.join(" ")).not.toContain("extraheader")
  })
})

describe("ensureRepoCloned", () => {
  it("skips (returns null) when no target is configured", async () => {
    await expect(ensureRepoCloned(null)).resolves.toBeNull()
  })
})
