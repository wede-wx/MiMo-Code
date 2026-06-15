/** Agent types that are spawned by the runtime (prune, scheduler, system code),
 *  NOT by the model. They get tool whitelist defaults and are skipped by
 *  prune/bootstrap/memory/recall scans.
 */
export const SYSTEM_SPAWNED_AGENT_TYPES: ReadonlySet<string> = new Set([
  "checkpoint-writer",
  "dream",
  "distill",
  "atlas",
  "atlas-appeal",
])

/** Hidden subagents that are spawned only through command-generated subtask parts.
 * They remain hidden from the normal actor tool suggestions, but the actor
 * tool schema must accept them so the command pipeline can invoke them.
 */
export const COMMAND_INTERNAL_SUBAGENT_TYPES: ReadonlySet<string> = new Set(["atlas", "atlas-appeal"])
