import type { KnowledgeBase } from "@eng/core"
import { eq, like } from "drizzle-orm"
import { db } from "./client"
import { kbDocs } from "./schema"

/** KnowledgeBase backed by Postgres (the `kb_docs` table). */
export class DbKnowledgeBase implements KnowledgeBase {
  async read(path: string): Promise<string | null> {
    const row = (
      await db
        .select({ content: kbDocs.content })
        .from(kbDocs)
        .where(eq(kbDocs.path, path))
        .limit(1)
    )[0]
    return row?.content ?? null
  }

  async write(path: string, content: string): Promise<void> {
    await db
      .insert(kbDocs)
      .values({ path, content })
      .onConflictDoUpdate({ target: kbDocs.path, set: { content, updatedAt: new Date() } })
  }

  async list(prefix = ""): Promise<string[]> {
    const rows = await db
      .select({ path: kbDocs.path })
      .from(kbDocs)
      .where(like(kbDocs.path, `${prefix}%`))
    return rows.map((r) => r.path)
  }
}
