import type { Persistence, PersistenceBackend } from "@eng/core"
import { DbAuditLog, DbDecisionLog, DbHierarchy, DbIssueTracker, DbKnowledgeBase } from "@eng/db"
import {
  createGitHubHierarchy,
  createGitHubIssueTracker,
  createGitHubKnowledgeBase,
  KnowledgeBackedDecisionLog,
} from "@eng/integrations"

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
  // The decision graph (ENG-014) indexes in Postgres — like the audit log, it's the queryable
  // substrate — and writes a human-readable body to whichever KB the backend uses (PR-reviewable
  // files on the GitHub backend).
  if (backend === "github") {
    const gh = githubConfig()
    if (gh) {
      const hierarchy = createGitHubHierarchy(gh)
      const tracker = createGitHubIssueTracker(gh, hierarchy)
      const knowledge = createGitHubKnowledgeBase({ ...gh, prefix: process.env.GITHUB_DOCS_PREFIX })
      const decisions = new KnowledgeBackedDecisionLog(new DbDecisionLog(), knowledge)
      return { tracker, knowledge, hierarchy, audit, decisions }
    }
  }
  const knowledge = new DbKnowledgeBase()
  return {
    tracker: new DbIssueTracker(),
    knowledge,
    hierarchy: new DbHierarchy(),
    audit,
    decisions: new KnowledgeBackedDecisionLog(new DbDecisionLog(), knowledge),
  }
}

export function persistenceFromEnv(): Persistence {
  return createPersistence(process.env.PERSISTENCE_BACKEND === "github" ? "github" : "postgres")
}
