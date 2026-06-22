import type { Hierarchy, HierarchyNode } from "@eng/core"
import {
  createEpic,
  createGoal,
  getEpicContext,
  getTraceContext,
  listEpics,
  listGoals,
} from "./repo"

/** Hierarchy backed by Postgres (the mission→goal→epic rows + traceability join). */
export class DbHierarchy implements Hierarchy {
  traceContext(ticketId: string): Promise<string> {
    return getTraceContext(ticketId)
  }

  epicContext(epicId: string): Promise<string> {
    return getEpicContext(epicId)
  }

  listGoals(): Promise<HierarchyNode[]> {
    return listGoals()
  }

  createGoal(input: { title: string; description?: string }): Promise<HierarchyNode> {
    return createGoal(input)
  }

  listEpics(goalId?: string): Promise<HierarchyNode[]> {
    return listEpics(goalId)
  }

  createEpic(input: {
    title: string
    description?: string
    goalId?: string
  }): Promise<HierarchyNode> {
    return createEpic(input)
  }
}
