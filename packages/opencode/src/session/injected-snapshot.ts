import { createHash } from "crypto"
import { appendFile, mkdir } from "fs/promises"
import path from "path"
import { Effect } from "effect"
import type { ProjectID } from "@/project/schema"
import { MessageID, SessionID } from "./schema"

type Instructions = {
  content: string[]
}

type SnapshotSource = {
  path: string
  content: string
}

export type SnapshotIndexRow = {
  message_id: string
  time: number
  hash: string
}

const INSTRUCTIONS_FROM_PATTERN = /^Instructions from: (.+)\r?\n/

export function shouldCaptureInjectedSnapshot(input: {
  parentSessionID?: SessionID
  agentID?: string
  isolateInstructions?: boolean
}) {
  if (input.parentSessionID) return false
  if ((input.agentID ?? "main") !== "main") return false
  if (input.isolateInstructions) return false
  return true
}

function sourceFromInstructionBlock(content: string): SnapshotSource | undefined {
  const match = content.match(INSTRUCTIONS_FROM_PATTERN)
  if (!match) return undefined
  return { path: match[1], content }
}

function memorySource(file: string) {
  return Effect.gen(function* () {
    const exists = yield* Effect.promise(() => Bun.file(file).exists())
    if (!exists) return undefined
    return {
      path: file,
      content: `Instructions from: ${file}\n${yield* Effect.promise(() => Bun.file(file).text())}`,
    } satisfies SnapshotSource
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function snapshotBody(sources: SnapshotSource[]) {
  return sources.map((source) => source.content).join("\n\n---\n\n")
}

export function injectedSnapshotIndexPath(memoryRoot: string, sessionID: SessionID) {
  return path.join(memoryRoot, "sessions", sessionID, "injected", "index.jsonl")
}

/**
 * Pick the injected snapshot the main agent held when entering an audited range.
 * `boundary` (T) is the audited range's after_time. The correct appealed
 * snapshot is the newest row with anchor time <= T, which is the injected
 * context version main held when entering that audited range. Never choose a
 * row after T, because that would read a newer context version created after
 * the audited boundary.
 */
export function pickAppealedSnapshotHash(rows: SnapshotIndexRow[], boundary: number) {
  return rows
    .filter((row) => row.time <= boundary)
    .sort((a, b) => b.time - a.time)
    .at(0)?.hash
}

function parseSnapshotIndexLine(line: string): SnapshotIndexRow | undefined {
  try {
    const value = JSON.parse(line)
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    if (typeof value.message_id !== "string") return undefined
    if (typeof value.time !== "number") return undefined
    if (typeof value.hash !== "string") return undefined
    return { message_id: value.message_id, time: value.time, hash: value.hash }
  } catch {
    return undefined
  }
}

/**
 * Resolve the appealed injected snapshot for a pure boundary input.
 * The caller owns deriving a same-source after_time boundary; this helper only
 * reads the session snapshot index and returns the corresponding
 * content-addressed file.
 */
export const resolveAppealedSnapshotPath = Effect.fn("InjectedSnapshot.resolveAppealed")(function* (input: {
  memoryRoot: string
  sessionID: SessionID
  boundary: number
}) {
  const index = injectedSnapshotIndexPath(input.memoryRoot, input.sessionID)
  const exists = yield* Effect.promise(() => Bun.file(index).exists()).pipe(Effect.catch(() => Effect.succeed(false)))
  if (!exists) return undefined
  const rows = (yield* Effect.promise(() => Bun.file(index).text()).pipe(Effect.catch(() => Effect.succeed(""))))
    .split(/\r?\n/)
    .filter(Boolean)
    .map(parseSnapshotIndexLine)
    .filter((row): row is SnapshotIndexRow => !!row)
  const hash = pickAppealedSnapshotHash(rows, input.boundary)
  if (!hash) return undefined
  return path.join(path.dirname(index), `${hash}.md`)
})

function frontmatter(input: {
  sessionID: SessionID
  hash: string
  anchorMessageID: MessageID
  anchorTime: number
  sources: string[]
}) {
  return [
    "---",
    `sessionID: ${input.sessionID}`,
    `hash: ${input.hash}`,
    `first_seen_message: ${input.anchorMessageID}`,
    `first_seen_time: ${input.anchorTime}`,
    "sources:",
    ...input.sources.map((source) => `  - ${JSON.stringify(source)}`),
    "---",
    "",
  ].join("\n")
}

export const captureInjectedSnapshot = Effect.fn("InjectedSnapshot.capture")(function* (input: {
  sessionID: SessionID
  instructions: Instructions
  memoryRoot: string
  projectID: ProjectID
  anchorMessageID: MessageID
  anchorTime: number
}) {
  const sources = [
    ...input.instructions.content.map(sourceFromInstructionBlock).filter((source): source is SnapshotSource => !!source),
    ...(
      yield* Effect.all([
        memorySource(path.join(input.memoryRoot, "projects", input.projectID, "MEMORY.md")),
        memorySource(path.join(input.memoryRoot, "global", "MEMORY.md")),
      ])
    ).filter((source): source is SnapshotSource => !!source),
  ]
  if (sources.length === 0) return undefined

  const body = snapshotBody(sources)
  const hash = createHash("sha256").update(body).digest("hex")
  const index = injectedSnapshotIndexPath(input.memoryRoot, input.sessionID)
  const dir = path.dirname(index)
  const file = path.join(dir, `${hash}.md`)
  yield* Effect.promise(() => mkdir(dir, { recursive: true }))
  if (!(yield* Effect.promise(() => Bun.file(file).exists()))) {
    yield* Effect.promise(() =>
      Bun.write(
        file,
        frontmatter({
          sessionID: input.sessionID,
          hash,
          anchorMessageID: input.anchorMessageID,
          anchorTime: input.anchorTime,
          sources: Array.from(new Set(sources.map((source) => source.path))),
        }) + body,
      ),
    )
  }
  yield* Effect.promise(() =>
    appendFile(
      index,
      JSON.stringify({
        message_id: input.anchorMessageID,
        time: input.anchorTime,
        hash,
      }) + "\n",
    ),
  )
  return { hash, path: file }
})
