/**
 * Heartbeat: wakes each role on a cadence (or on assignment) to check its queue and act. In
 * production this is backed by a Temporal Schedule rather than an in-process timer, so it survives
 * restarts like the rest of the durability layer.
 */
export function startHeartbeat(): void {
  // TODO: register a Temporal Schedule per role that nudges the role's work queue.
}
