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
