import { Effect } from "effect"
import z from "zod"
import { and, asc, count, Database, eq, gt } from "@/storage"
import { MessageTable, PartTable } from "@/session/session.sql"
import { SessionID } from "@/session/schema"
import DESCRIPTION from "./audit_trajectory.txt"
import * as Tool from "./tool"

const MAX_BYTES = 16 * 1024
const encoder = new TextEncoder()

const parameters = z.object({
  session_id: z.string().describe("Session id to audit."),
  agent_id: z.string().optional().describe("Optional message agent_id slice. Omit to read the whole session."),
  after_time: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Only return parts with part_time_created > after_time (epoch ms). Omit = no lower bound."),
  offset: z.number().int().nonnegative().optional().describe("Part offset, default 0."),
  limit: z.number().int().positive().max(200).optional().describe("Max parts, default 50, max 200."),
})

type Row = {
  part_id: string
  message_id: string
  agent_id: string
  message_time_created: number
  part_time_created: number
  message_data: Record<string, unknown>
  part_data: Record<string, unknown>
}

function stringify(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2)
}

function record(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function line(label: string, value: unknown) {
  const text = stringify(value)
  return text === undefined ? [] : [`${label}:`, text]
}

function toolState(data: Record<string, unknown>) {
  const state = record(data.state)
  const metadata = record(state?.metadata)
  return {
    state,
    metadata,
  }
}

function format(row: Row, index: number) {
  const role = typeof row.message_data.role === "string" ? row.message_data.role : "unknown"
  const type = typeof row.part_data.type === "string" ? row.part_data.type : "unknown"
  const lines = [
    `### ${index + 1}. part ${row.part_id}`,
    `message_id: ${row.message_id}`,
    `agent_id: ${row.agent_id}`,
    `role: ${role}`,
    `part_type: ${type}`,
    `message_time: ${new Date(row.message_time_created).toISOString()}`,
    `part_time: ${new Date(row.part_time_created).toISOString()}`,
  ]

  if (type === "text" || type === "reasoning") {
    lines.push(...line(type, row.part_data.text))
    const metadata = record(row.part_data.metadata)
    if (metadata) lines.push(...line("metadata", metadata))
    return lines.join("\n")
  }

  if (type === "tool") {
    const state = toolState(row.part_data)
    lines.push(`tool: ${typeof row.part_data.tool === "string" ? row.part_data.tool : "unknown"}`)
    if (state.state?.status) lines.push(`status: ${String(state.state.status)}`)
    lines.push(...line("input", state.state?.input))
    lines.push(...line("output", state.state?.output))
    lines.push(...line("error", state.state?.error))
    if (state.metadata && "exit" in state.metadata) lines.push(`exit: ${String(state.metadata.exit)}`)
    if (state.metadata && "diff" in state.metadata) lines.push(...line("diff", state.metadata.diff))
    if (state.metadata) lines.push(...line("metadata", state.metadata))
    const partMetadata = record(row.part_data.metadata)
    if (partMetadata) lines.push(...line("part_metadata", partMetadata))
    return lines.join("\n")
  }

  lines.push(...line("data", row.part_data))
  return lines.join("\n")
}

function bytes(value: string) {
  return encoder.encode(value).byteLength
}

export const AuditTrajectoryTool = Tool.define(
  "audit_trajectory",
  Effect.succeed({
    description: DESCRIPTION,
    parameters,
    execute: (args: z.infer<typeof parameters>) =>
      Effect.sync(() => {
        const input = parameters.parse(args)
        const offset = input.offset ?? 0
        const limit = input.limit ?? 50
        const sessionID = SessionID.make(input.session_id)
        const conds = [eq(PartTable.session_id, sessionID)]
        if (input.agent_id) conds.push(eq(MessageTable.agent_id, input.agent_id))
        if (input.after_time !== undefined) conds.push(gt(PartTable.time_created, input.after_time))
        const where = and(...conds)
        const total =
          Database.use((db) =>
            db
              .select({ value: count() })
              .from(PartTable)
              .innerJoin(MessageTable, eq(PartTable.message_id, MessageTable.id))
              .where(where)
              .get(),
          )?.value ?? 0
        const rows = Database.use((db) =>
          db
            .select({
              part_id: PartTable.id,
              message_id: PartTable.message_id,
              agent_id: MessageTable.agent_id,
              message_time_created: MessageTable.time_created,
              part_time_created: PartTable.time_created,
              message_data: MessageTable.data,
              part_data: PartTable.data,
            })
            .from(PartTable)
            .innerJoin(MessageTable, eq(PartTable.message_id, MessageTable.id))
            .where(where)
            .orderBy(asc(PartTable.time_created), asc(PartTable.id))
            .limit(limit)
            .offset(offset)
            .all(),
        ) as Row[]

        const selected: string[] = []
        let size = 0
        for (const row of rows) {
          const block = format(row, offset + selected.length)
          const next = size + bytes(block) + 2
          if (selected.length > 0 && next > MAX_BYTES) break
          selected.push(block)
          size = next
        }

        const returned = selected.length
        const nextOffset = offset + returned
        const hasMore = nextOffset < total
        const output = [
          `Session ${input.session_id}${input.agent_id ? `, agent ${input.agent_id}` : ""}: ${returned}/${total} parts from offset ${offset}`,
          "",
          selected.length > 0 ? selected.join("\n\n") : "No trajectory parts found.",
        ].join("\n")

        return {
          title: `Audit trajectory ${input.session_id}`,
          output,
          metadata: {
            total,
            offset,
            returned,
            hasMore,
            nextOffset: hasMore ? nextOffset : undefined,
            truncated: false,
          },
        }
      }),
  }),
)
