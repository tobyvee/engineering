import { timingSafeEqual } from "node:crypto"
import type { MiddlewareHandler } from "hono"

/**
 * API authentication (ENG-004). The approval gates are the product's core value (invariant #4), so
 * mutating requests must be authenticated and the deciding principal recorded. Auth activates when
 * `API_AUTH_TOKEN` is set; when it isn't, the server runs in an open "dev mode" (and warns loudly at
 * startup) so the local `docker compose up` quickstart keeps working — set the token to enforce.
 */

/** Hono environment: the authenticated principal attributed to writes (audit identity). */
export type AppEnv = { Variables: { actor: string } }

const ACTOR_HEADER = "x-actor"

export interface AuthResult {
  ok: boolean
  /** Who to attribute the write to in the audit log. */
  principal: string
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/**
 * Decide whether a request is authorized and who the principal is. Pure + header-driven for testing.
 * - No configured token → dev mode: allowed, principal `dev`.
 * - Configured token → requires `Authorization: Bearer <token>`; principal from `X-Actor`
 *   (default `operator`). A bad/missing token → not ok.
 */
export function checkAuth(
  headers: { authorization?: string | null; actor?: string | null },
  configuredToken: string | undefined,
): AuthResult {
  if (!configuredToken) return { ok: true, principal: "dev" }
  const match = /^Bearer\s+(.+)$/i.exec((headers.authorization ?? "").trim())
  const token = match?.[1]
  if (!token || !safeEqual(token, configuredToken)) {
    return { ok: false, principal: "anonymous" }
  }
  const actor = (headers.actor ?? "").trim()
  return { ok: true, principal: actor || "operator" }
}

/**
 * Hono middleware enforcing auth on mutating requests. GET (read views) and `/health` stay open; any
 * non-GET request requires auth when a token is configured. The resolved principal is stored on the
 * context for handlers to attribute approvals/writes to.
 */
export function authMiddleware(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.method === "GET") {
      c.set("actor", "anonymous")
      return next()
    }
    const result = checkAuth(
      { authorization: c.req.header("authorization"), actor: c.req.header(ACTOR_HEADER) },
      process.env.API_AUTH_TOKEN,
    )
    if (!result.ok) return c.json({ error: "unauthorized" }, 401)
    c.set("actor", result.principal)
    return next()
  }
}

/** Log a one-time warning if auth is disabled (no token configured). Call at server startup. */
export function warnIfAuthDisabled(): void {
  if (!process.env.API_AUTH_TOKEN) {
    console.warn(
      "[auth] API_AUTH_TOKEN is not set — mutating endpoints (incl. approval gates) are UNAUTHENTICATED. " +
        "Set API_AUTH_TOKEN to require a Bearer token before any shared/live deployment.",
    )
  }
}
