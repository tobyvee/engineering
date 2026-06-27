import { Hono } from "hono"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { type AppEnv, authMiddleware, checkAuth } from "./auth"

describe("checkAuth", () => {
  it("allows dev mode (principal 'dev') when no token is configured", () => {
    expect(checkAuth({}, undefined)).toEqual({ ok: true, principal: "dev" })
  })

  it("accepts a correct Bearer token and defaults the principal to 'operator'", () => {
    const r = checkAuth({ authorization: "Bearer s3cret" }, "s3cret")
    expect(r).toEqual({ ok: true, principal: "operator" })
  })

  it("honors the X-Actor header as the principal", () => {
    const r = checkAuth({ authorization: "Bearer s3cret", actor: "toby" }, "s3cret")
    expect(r).toEqual({ ok: true, principal: "toby" })
  })

  it("rejects a missing or wrong token", () => {
    expect(checkAuth({}, "s3cret").ok).toBe(false)
    expect(checkAuth({ authorization: "Bearer nope" }, "s3cret").ok).toBe(false)
    expect(checkAuth({ authorization: "s3cret" }, "s3cret").ok).toBe(false) // missing "Bearer "
  })
})

describe("authMiddleware", () => {
  const prev = process.env.API_AUTH_TOKEN
  let app: Hono<AppEnv>

  beforeEach(() => {
    app = new Hono<AppEnv>()
    app.use("/api/*", authMiddleware())
    app.get("/api/thing", (c) => c.json({ actor: c.get("actor") }))
    app.post("/api/thing", (c) => c.json({ actor: c.get("actor") }))
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.API_AUTH_TOKEN
    else process.env.API_AUTH_TOKEN = prev
  })

  it("leaves GET read views open", async () => {
    process.env.API_AUTH_TOKEN = "s3cret"
    const res = await app.request("/api/thing")
    expect(res.status).toBe(200)
  })

  it("401s an unauthenticated mutation when a token is configured", async () => {
    process.env.API_AUTH_TOKEN = "s3cret"
    const res = await app.request("/api/thing", { method: "POST" })
    expect(res.status).toBe(401)
  })

  it("allows an authenticated mutation and exposes the principal", async () => {
    process.env.API_AUTH_TOKEN = "s3cret"
    const res = await app.request("/api/thing", {
      method: "POST",
      headers: { authorization: "Bearer s3cret", "x-actor": "toby" },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ actor: "toby" })
  })

  it("allows mutations in dev mode when no token is configured", async () => {
    delete process.env.API_AUTH_TOKEN
    const res = await app.request("/api/thing", { method: "POST" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ actor: "dev" })
  })
})
