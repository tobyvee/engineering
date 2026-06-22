import type { Hierarchy } from "@eng/core"
import { getTraceContext } from "./repo"

/** Hierarchy backed by Postgres (the mission→goal→epic→ticket join). */
export class DbHierarchy implements Hierarchy {
  traceContext(ticketId: string): Promise<string> {
    return getTraceContext(ticketId)
  }
}
