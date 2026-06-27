import { fileURLToPath } from "node:url"
import { TestWorkflowEnvironment } from "@temporalio/testing"
import { bundleWorkflowCode, Worker, type WorkflowBundle } from "@temporalio/worker"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  approveSignal,
  epicDecomposition,
  epicShaping,
  heartbeat,
  roadmapSignal,
  ticketLifecycle,
} from "./workflows"

/**
 * ENG-002 — exercises the durable orchestration layer with Temporal's time-skipping test
 * environment and mocked activities. Time-skipping fast-forwards the CI/deploy poll `sleep`s; the
 * approval gates (Signals) are driven explicitly. All GitHub/DB/agent I/O is mocked, so these run
 * with no live services. The workflow code is bundled once (`beforeAll`) and reused per test.
 */

const TQ = "test"
const workflowsPath = fileURLToPath(new URL("./workflows.ts", import.meta.url))

let env: TestWorkflowEnvironment
let bundle: WorkflowBundle
let wfId = 0
const nextId = (p: string) => `${p}-${++wfId}`

beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping()
  bundle = await bundleWorkflowCode({ workflowsPath })
}, 120_000)

afterAll(async () => {
  await env?.teardown()
})

/** Happy-path activity mocks; pass overrides to force failure branches. */
function makeActivities(overrides: Record<string, unknown> = {}) {
  return {
    transitionTicket: vi.fn(async (_id: string, _status: string) => {}),
    implementTicket: vi.fn(async (_id: string) => ({
      number: 1,
      url: "http://pr/1",
      branch: "ticket/t",
    })),
    verifyTicket: vi.fn(async (_id: string) => ({ passed: true, feedback: "" })),
    checkDeliveryStatus: vi.fn(async (_pr: unknown) => "success"),
    mergeDelivery: vi.fn(async (_id: string, _pr: unknown) => true),
    startDeploy: vi.fn(async (_id: string) => 42),
    checkDeployStatus: vi.fn(async (_runId: number) => "success"),
    recordDeploy: vi.fn(async (_id: string, _state: string) => {}),
    pickUpBacklog: vi.fn(async () => 0),
    decomposeEpic: vi.fn(async (_epicId: string) => ["ticket-1"]),
    runShapingStage: vi.fn(async (_epicId: string, _stageKey: string) => {}),
    requestRoadmapSignoff: vi.fn(async (_epicId: string) => {}),
    recordRoadmapApproval: vi.fn(async (_epicId: string) => {}),
    requestApproval: vi.fn(async (_kind: string, _ticketId: string) => {}),
    ...overrides,
  }
}

type Activities = ReturnType<typeof makeActivities>

/** Run `cb` with a worker bound to `activities` for the duration, then shut it down. */
async function withWorker<T>(activities: Activities, cb: () => Promise<T>): Promise<T> {
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: TQ,
    workflowBundle: bundle,
    activities,
  })
  return worker.runUntil(cb)
}

describe("ticketLifecycle", () => {
  it("reaches done when both gates are approved", async () => {
    const acts = makeActivities()
    await withWorker(acts, async () => {
      const handle = await env.client.workflow.start(ticketLifecycle, {
        taskQueue: TQ,
        workflowId: nextId("ticket"),
        args: ["t1"],
      })
      await handle.signal(approveSignal, "merge")
      await handle.signal(approveSignal, "deploy")
      await handle.result()
    })

    expect(acts.mergeDelivery).toHaveBeenCalledTimes(1)
    expect(acts.recordDeploy).toHaveBeenCalledWith("t1", "success")
    expect(acts.transitionTicket).toHaveBeenCalledWith("t1", "done")
    expect(acts.transitionTicket).not.toHaveBeenCalledWith("t1", "blocked")
  }, 30_000)

  it("blocks on the merge gate until approved", async () => {
    const acts = makeActivities()
    await withWorker(acts, async () => {
      const handle = await env.client.workflow.start(ticketLifecycle, {
        taskQueue: TQ,
        workflowId: nextId("ticket"),
        args: ["t1"],
      })
      // Let the workflow run to the merge gate; with no signal it stays blocked (no timer to skip).
      await env.sleep("1 day")
      expect(acts.verifyTicket).toHaveBeenCalledTimes(1)
      expect(acts.mergeDelivery).not.toHaveBeenCalled()

      await handle.signal(approveSignal, "merge")
      await handle.signal(approveSignal, "deploy")
      await handle.result()
    })

    expect(acts.transitionTicket).toHaveBeenCalledWith("t1", "done")
  }, 30_000)

  it("reworks up to the attempt limit on persistent QA failure, then blocks", async () => {
    const acts = makeActivities({
      verifyTicket: vi.fn(async (_id: string) => ({ passed: false, feedback: "still broken" })),
    })
    await withWorker(acts, async () => {
      const handle = await env.client.workflow.start(ticketLifecycle, {
        taskQueue: TQ,
        workflowId: nextId("ticket"),
        args: ["t1"],
      })
      await handle.result() // no signal needed — exhausts rework attempts then blocks
    })

    expect(acts.implementTicket).toHaveBeenCalledTimes(2) // bounced back and retried (ENG-008)
    expect(acts.transitionTicket).toHaveBeenCalledWith("t1", "blocked")
    expect(acts.mergeDelivery).not.toHaveBeenCalled()
    expect(acts.transitionTicket).not.toHaveBeenCalledWith("t1", "done")
  }, 30_000)

  it("reworks once with the QA feedback, then reaches done on a pass", async () => {
    const verifyTicket = vi
      .fn()
      .mockResolvedValueOnce({ passed: false, feedback: "add a test" })
      .mockResolvedValue({ passed: true, feedback: "" })
    const acts = makeActivities({ verifyTicket })
    await withWorker(acts, async () => {
      const handle = await env.client.workflow.start(ticketLifecycle, {
        taskQueue: TQ,
        workflowId: nextId("ticket"),
        args: ["t1"],
      })
      await handle.signal(approveSignal, "merge")
      await handle.signal(approveSignal, "deploy")
      await handle.result()
    })

    expect(acts.implementTicket).toHaveBeenCalledTimes(2) // reworked once
    expect(acts.implementTicket).toHaveBeenLastCalledWith("t1", "add a test") // fed the feedback
    expect(acts.transitionTicket).toHaveBeenCalledWith("t1", "done")
    expect(acts.transitionTicket).not.toHaveBeenCalledWith("t1", "blocked")
  }, 30_000)

  it("blocks the ticket when the merge fails", async () => {
    const acts = makeActivities({
      mergeDelivery: vi.fn(async (_id: string, _pr: unknown) => false),
    })
    await withWorker(acts, async () => {
      const handle = await env.client.workflow.start(ticketLifecycle, {
        taskQueue: TQ,
        workflowId: nextId("ticket"),
        args: ["t1"],
      })
      await handle.signal(approveSignal, "merge")
      await handle.result()
    })

    expect(acts.transitionTicket).toHaveBeenCalledWith("t1", "blocked")
    expect(acts.startDeploy).not.toHaveBeenCalled()
    expect(acts.transitionTicket).not.toHaveBeenCalledWith("t1", "done")
  }, 30_000)

  it("blocks the ticket when the deploy fails", async () => {
    const acts = makeActivities({
      checkDeployStatus: vi.fn(async (_runId: number) => "failure"),
    })
    await withWorker(acts, async () => {
      const handle = await env.client.workflow.start(ticketLifecycle, {
        taskQueue: TQ,
        workflowId: nextId("ticket"),
        args: ["t1"],
      })
      await handle.signal(approveSignal, "merge")
      await handle.signal(approveSignal, "deploy")
      await handle.result()
    })

    expect(acts.recordDeploy).toHaveBeenCalledWith("t1", "failure")
    expect(acts.transitionTicket).toHaveBeenCalledWith("t1", "blocked")
    expect(acts.transitionTicket).not.toHaveBeenCalledWith("t1", "done")
  }, 30_000)
})

describe("epicDecomposition", () => {
  it("blocks on the roadmap gate until signed off, then decomposes", async () => {
    const acts = makeActivities()
    await withWorker(acts, async () => {
      const handle = await env.client.workflow.start(epicDecomposition, {
        taskQueue: TQ,
        workflowId: nextId("epic"),
        args: ["e1"],
      })
      await env.sleep("1 day")
      expect(acts.requestRoadmapSignoff).toHaveBeenCalledWith("e1")
      expect(acts.decomposeEpic).not.toHaveBeenCalled()

      await handle.signal(roadmapSignal)
      await handle.result()
    })

    expect(acts.recordRoadmapApproval).toHaveBeenCalledWith("e1")
    expect(acts.decomposeEpic).toHaveBeenCalledWith("e1")
  }, 30_000)
})

describe("epicShaping", () => {
  it("runs every shaping stage in order", async () => {
    const acts = makeActivities()
    await withWorker(acts, async () => {
      await env.client.workflow.execute(epicShaping, {
        taskQueue: TQ,
        workflowId: nextId("shape"),
        args: ["e1"],
      })
    })
    // One call per stage (PM → UX → Architect → System Design).
    expect(acts.runShapingStage.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(acts.runShapingStage).toHaveBeenCalledWith("e1", "discovery")
    expect(acts.runShapingStage).toHaveBeenCalledWith("e1", "system_design")
  }, 30_000)
})

describe("heartbeat", () => {
  it("picks up the backlog", async () => {
    const acts = makeActivities()
    await withWorker(acts, async () => {
      await env.client.workflow.execute(heartbeat, {
        taskQueue: TQ,
        workflowId: nextId("hb"),
        args: [],
      })
    })
    expect(acts.pickUpBacklog).toHaveBeenCalledTimes(1)
  }, 30_000)
})
