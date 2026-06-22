import type { Persistence, PersistenceBackend } from "@eng/core"
import { DbAuditLog, DbIssueTracker, DbKnowledgeBase } from "@eng/db"
import { createGitHubIssueTracker, createGitHubKnowledgeBase } from "@eng/integrations"

function githubConfig(): { token: string; owner: string; repo: string } | null {
  const token = process.env.GITHUB_TOKEN
  const owner = process.env.GITHUB_OWNER
  const repo = process.env.GITHUB_REPO
  return token && owner && repo ? { token, owner, repo } : null
}

/**
 * Assemble the agents' persistence layer for a backend (the adapter/factory seam). The tracker and
 * knowledge base swap per backend; the append-only audit log stays in Postgres (it's the dashboard
 * read-model). The GitHub backend falls back to Postgres when GitHub isn't configured.
 */
export function createPersistence(backend: PersistenceBackend): Persistence {
  const audit = new DbAuditLog()
  if (backend === "github") {
    const gh = githubConfig()
    if (gh) {
      return {
        tracker: createGitHubIssueTracker(gh),
        knowledge: createGitHubKnowledgeBase({ ...gh, prefix: process.env.GITHUB_DOCS_PREFIX }),
        audit,
      }
    }
  }
  return { tracker: new DbIssueTracker(), knowledge: new DbKnowledgeBase(), audit }
}

export function persistenceFromEnv(): Persistence {
  return createPersistence(process.env.PERSISTENCE_BACKEND === "github" ? "github" : "postgres")
}
