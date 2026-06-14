import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { and, count, Database, eq } from "../../src/storage"
import { MessageTable, PartTable, SessionTable } from "../../src/session/session.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { AuditTrajectoryTool } from "../../src/tool/audit_trajectory"
import { ToolRegistry } from "../../src/tool"
import { HistoryTool } from "../../src/tool/history"
import { History } from "../../src/history"
import { HistoryFtsTable } from "../../src/history/fts.sql"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { Truncate } from "../../src/tool"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { MessageID, SessionID } from "../../src/session/schema"
import { ModelID, ProviderID } from "../../src/provider/schema"

afterEach(async () => {
  Database.use((db) => {
    db.delete(HistoryFtsTable).run()
    db.delete(PartTable).run()
    db.delete(MessageTable).run()
    db.delete(SessionTable).run()
    db.delete(ProjectTable).run()
  })
  await Instance.disposeAll()
})

const it = testEffect(
  Layer.mergeAll(History.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer),
)
const registryIt = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, Agent.defaultLayer, CrossSpawnSpawner.defaultLayer))

const ctx = {
  sessionID: SessionID.make("ses_audit"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const now = 1_700_000_000_000

function insertProjectAndSession(sessionID = "ses_audit") {
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: "proj_audit" as any,
        worktree: "/tmp/audit",
        sandboxes: [] as any,
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(SessionTable)
      .values({
        id: sessionID as any,
        project_id: "proj_audit" as any,
        slug: "audit",
        directory: "/tmp/audit",
        title: "Audit",
        version: "1",
        time_created: now,
        time_updated: now,
      })
      .run()
  })
}

function insertMessage(input: {
  id: string
  sessionID?: string
  agentID?: string
  role: "user" | "assistant"
  time: number
}) {
  Database.use((db) => {
    db.insert(MessageTable)
      .values({
        id: input.id as any,
        session_id: (input.sessionID ?? "ses_audit") as any,
        agent_id: input.agentID ?? "main",
        data: { role: input.role } as any,
        time_created: input.time,
        time_updated: input.time,
      })
      .run()
  })
}

function insertPart(input: {
  id: string
  messageID: string
  sessionID?: string
  time: number
  data: Record<string, unknown>
}) {
  Database.use((db) => {
    db.insert(PartTable)
      .values({
        id: input.id as any,
        message_id: input.messageID as any,
        session_id: (input.sessionID ?? "ses_audit") as any,
        data: input.data as any,
        time_created: input.time,
        time_updated: input.time,
      })
      .run()
  })
}

function tableCounts() {
  return Database.use((db) => ({
    messages: db.select({ value: count() }).from(MessageTable).get()!.value,
    parts: db.select({ value: count() }).from(PartTable).get()!.value,
  }))
}

describe("AuditTrajectoryTool", () => {
  registryIt.live("is registered and exposed to atlas while bash remains as the step-1 safety net", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const registry = yield* ToolRegistry.Service
        const atlas = yield* agents.get("atlas")
        const tools = yield* registry.tools({
          providerID: ProviderID.make("test"),
          modelID: ModelID.make("test-model"),
          agent: atlas,
        })
        const ids = tools.map((tool) => tool.id)

        expect(ids).toContain("audit_trajectory")
        expect(ids).toContain("bash")
      }),
    ),
  )

  it.live("returns complete ordered audit fields, including exit code, diff, metadata, text, and reasoning", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        insertProjectAndSession()
        insertMessage({ id: "m_user", role: "user", time: now + 1 })
        insertPart({ id: "p_user", messageID: "m_user", time: now + 2, data: { type: "text", text: "user asks for audit" } })
        insertMessage({ id: "m_assistant", role: "assistant", time: now + 3 })
        insertPart({
          id: "p_reason",
          messageID: "m_assistant",
          time: now + 4,
          data: { type: "reasoning", text: "reasoning trace", time: { start: now + 4 } },
        })
        insertPart({ id: "p_text", messageID: "m_assistant", time: now + 5, data: { type: "text", text: "assistant says done" } })
        insertPart({
          id: "p_bash",
          messageID: "m_assistant",
          time: now + 6,
          data: {
            type: "tool",
            callID: "call_bash",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "bun test" },
              output: "failed to add snapshot files",
              title: "bun test",
              metadata: { exit: 128 },
              time: { start: now + 6, end: now + 7 },
            },
          },
        })
        insertPart({
          id: "p_write",
          messageID: "m_assistant",
          time: now + 8,
          data: {
            type: "tool",
            callID: "call_write",
            tool: "write",
            state: {
              status: "completed",
              input: { filePath: "x.ts", content: "after" },
              output: "wrote file",
              title: "write x.ts",
              metadata: { diff: "<DIFFTEXT>", filepath: "x.ts", diagnostics: [] },
              time: { start: now + 8, end: now + 9 },
            },
          },
        })

        const info = yield* AuditTrajectoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ session_id: "ses_audit" }, ctx as any)

        expect(result.metadata.total).toBe(5)
        expect(result.metadata.returned).toBe(5)
        expect(result.metadata.offset).toBe(0)
        expect(result.metadata.hasMore).toBe(false)
        expect(result.metadata.truncated).toBe(false)
        expect(result.output.indexOf("p_user")).toBeLessThan(result.output.indexOf("p_reason"))
        expect(result.output.indexOf("p_reason")).toBeLessThan(result.output.indexOf("p_write"))
        expect(result.output).toContain("user asks for audit")
        expect(result.output).toContain("assistant says done")
        expect(result.output).toContain("reasoning trace")
        expect(result.output).toContain("exit: 128")
        expect(result.output).toContain("diff:")
        expect(result.output).toContain("<DIFFTEXT>")
        expect(result.output).toContain("filepath")
        expect(result.output).toContain("x.ts")
      }),
    ),
  )

  it.live("filters by message agent_id through the message join", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        insertProjectAndSession()
        insertMessage({ id: "m_main", role: "assistant", agentID: "main", time: now + 1 })
        insertPart({ id: "p_main", messageID: "m_main", time: now + 2, data: { type: "text", text: "main only" } })
        insertMessage({ id: "m_atlas", role: "assistant", agentID: "atlas-1", time: now + 3 })
        insertPart({ id: "p_atlas", messageID: "m_atlas", time: now + 4, data: { type: "text", text: "atlas only" } })

        const info = yield* AuditTrajectoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ session_id: "ses_audit", agent_id: "main" }, ctx as any)

        expect(result.metadata.total).toBe(1)
        expect(result.output).toContain("main only")
        expect(result.output).not.toContain("atlas only")
      }),
    ),
  )

  it.live("paginates by part without overlap and disables framework truncation", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        insertProjectAndSession()
        insertMessage({ id: "m_page", role: "assistant", time: now + 1 })
        for (let i = 0; i < 15; i++) {
          insertPart({
            id: `p_page_${i.toString().padStart(2, "0")}`,
            messageID: "m_page",
            time: now + 2 + i,
            data: { type: "text", text: `page item ${i}` },
          })
        }

        const info = yield* AuditTrajectoryTool
        const tool = yield* info.init()
        const first = yield* tool.execute({ session_id: "ses_audit", limit: 10 }, ctx as any)
        const second = yield* tool.execute({ session_id: "ses_audit", offset: first.metadata.nextOffset, limit: 10 }, ctx as any)

        expect(first.metadata.total).toBe(15)
        expect(first.metadata.returned).toBe(10)
        expect(first.metadata.hasMore).toBe(true)
        expect(first.metadata.nextOffset).toBe(10)
        expect(first.metadata.truncated).toBe(false)
        expect(second.metadata.returned).toBe(5)
        expect(second.metadata.hasMore).toBe(false)
        expect(second.metadata.truncated).toBe(false)
        expect(first.output).toContain("page item 0")
        expect(first.output).toContain("page item 9")
        expect(first.output).not.toContain("page item 10")
        expect(second.output).not.toContain("page item 9")
        expect(second.output).toContain("page item 10")
        expect(second.output).toContain("page item 14")
      }),
    ),
  )

  it.live("uses only read queries", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        insertProjectAndSession()
        insertMessage({ id: "m_readonly", role: "user", time: now + 1 })
        insertPart({ id: "p_readonly", messageID: "m_readonly", time: now + 2, data: { type: "text", text: "do not mutate" } })
        const before = tableCounts()

        const info = yield* AuditTrajectoryTool
        const tool = yield* info.init()
        yield* tool.execute({ session_id: "ses_audit" }, ctx as any)

        expect(tableCounts()).toEqual(before)
      }),
    ),
  )

  it.live("documents that history around omits audit-critical exit and diff metadata", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        Database.use((db) => {
          db.insert(HistoryFtsTable)
            .values({
              part_id: "history_p",
              session_id: "ses_audit",
              message_id: "history_m",
              project_id: "proj_audit",
              kind: "tool_output",
              tool_name: "bash",
              body: "failed to add snapshot files",
              time_created: now,
            })
            .run()
        })
        insertProjectAndSession()
        insertMessage({ id: "history_m", role: "assistant", time: now + 1 })
        insertPart({
          id: "history_p",
          messageID: "history_m",
          time: now + 2,
          data: {
            type: "tool",
            callID: "history_call",
            tool: "bash",
            state: {
              status: "completed",
              input: { command: "bun test" },
              output: "failed to add snapshot files",
              title: "bun test",
              metadata: { exit: 128, diff: "<DIFFTEXT>" },
              time: { start: now + 2, end: now + 3 },
            },
          },
        })

        const info = yield* HistoryTool
        const tool = yield* info.init()
        const result = yield* tool.execute({ operation: "around", message_id: "history_m" }, ctx as any)

        expect(result.output).not.toContain("128")
        expect(result.output).not.toContain("<DIFFTEXT>")
      }),
    ),
  )
})
