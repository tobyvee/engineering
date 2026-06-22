import { Client, Connection } from "@temporalio/client"

const TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "engineering"

let clientPromise: Promise<Client> | undefined

export async function getTemporalClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Connection.connect({
      address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    }).then((connection) => new Client({ connection }))
  }
  return clientPromise
}

export function ticketWorkflowId(ticketId: string): string {
  return `ticket-${ticketId}`
}

/** Start the durable lifecycle for a ticket. Idempotent — a ticket already started (e.g. by the
 *  heartbeat) is a no-op. Workflow/signal are referenced by name to keep callers free of the
 *  workflow sandbox imports. */
export async function startTicketLifecycle(ticketId: string): Promise<void> {
  const client = await getTemporalClient()
  try {
    await client.workflow.start("ticketLifecycle", {
      taskQueue: TASK_QUEUE,
      workflowId: ticketWorkflowId(ticketId),
      args: [ticketId],
    })
  } catch (err) {
    if ((err as { name?: string })?.name === "WorkflowExecutionAlreadyStartedError") return
    throw err
  }
}

/** Start agent-driven decomposition for an epic (idempotent while one is already running). */
export async function startEpicDecomposition(epicId: string): Promise<void> {
  const client = await getTemporalClient()
  try {
    await client.workflow.start("epicDecomposition", {
      taskQueue: TASK_QUEUE,
      workflowId: `epic-decompose-${epicId}`,
      args: [epicId],
    })
  } catch (err) {
    if ((err as { name?: string })?.name === "WorkflowExecutionAlreadyStartedError") return
    throw err
  }
}

/** Release an approval gate ("merge" or "deploy") by signaling the running workflow (invariant #4). */
export async function approveTicket(ticketId: string, gate: "merge" | "deploy"): Promise<void> {
  const client = await getTemporalClient()
  const handle = client.workflow.getHandle(ticketWorkflowId(ticketId))
  await handle.signal("approve", gate)
}
