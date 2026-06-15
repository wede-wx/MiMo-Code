import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import {
  captureInjectedSnapshot,
  pickAppealedSnapshotHash,
  resolveAppealedSnapshotPath,
  shouldCaptureInjectedSnapshot,
} from "../../src/session/injected-snapshot"
import { renderCommandTemplate } from "../../src/session/prompt"
import { MessageID, SessionID } from "../../src/session/schema"
import type { ProjectID } from "../../src/project/schema"
import { tmpdir } from "../fixture/fixture"

async function snapshotFiles(dir: string) {
  return (await fs.readdir(path.join(dir, "sessions", "ses_snapshot", "injected")).catch(() => []))
    .filter((item) => item.endsWith(".md"))
    .sort()
}

async function indexLines(dir: string) {
  return (await Bun.file(path.join(dir, "sessions", "ses_snapshot", "injected", "index.jsonl")).text())
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
}

describe("captureInjectedSnapshot", () => {
  test("stores the first main-turn snapshot with instruction and memory content", async () => {
    await using tmp = await tmpdir()
    const memoryRoot = path.join(tmp.path, "memory")
    const projectID = "proj_snapshot" as ProjectID
    await fs.mkdir(path.join(memoryRoot, "projects", projectID), { recursive: true })
    await fs.mkdir(path.join(memoryRoot, "global"), { recursive: true })
    await Bun.write(path.join(memoryRoot, "projects", projectID, "MEMORY.md"), "project memory body")
    await Bun.write(path.join(memoryRoot, "global", "MEMORY.md"), "global memory body")

    await Effect.runPromise(
      captureInjectedSnapshot({
        sessionID: SessionID.descending("ses_snapshot"),
        instructions: {
          content: ["Instructions from: C:\\repo\\CLAUDE.md\nclaude body"],
        },
        memoryRoot,
        projectID,
        anchorMessageID: MessageID.ascending("msg_one"),
        anchorTime: 111,
      }),
    )

    const files = await snapshotFiles(memoryRoot)
    expect(files).toHaveLength(1)
    const content = await Bun.file(path.join(memoryRoot, "sessions", "ses_snapshot", "injected", files[0])).text()
    expect(content).toContain("first_seen_message: msg_one")
    expect(content).toContain("first_seen_time: 111")
    expect(content).toContain("claude body")
    expect(content).toContain("project memory body")
    expect(content).toContain("global memory body")
    expect(await indexLines(memoryRoot)).toHaveLength(1)
  })

  test("deduplicates identical snapshot bodies while appending per-turn index entries", async () => {
    await using tmp = await tmpdir()
    const memoryRoot = path.join(tmp.path, "memory")
    const projectID = "proj_snapshot" as ProjectID

    for (const messageID of ["one", "two"]) {
      await Effect.runPromise(
        captureInjectedSnapshot({
          sessionID: SessionID.descending("ses_snapshot"),
          instructions: { content: ["Instructions from: C:\\repo\\AGENTS.md\nsame body"] },
          memoryRoot,
          projectID,
          anchorMessageID: MessageID.ascending(`msg_${messageID}`),
          anchorTime: messageID === "one" ? 111 : 222,
        }),
      )
    }

    expect(await snapshotFiles(memoryRoot)).toHaveLength(1)
    const lines = await indexLines(memoryRoot)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).hash).toBe(JSON.parse(lines[1]).hash)
    expect(JSON.parse(lines[0])).toMatchObject({ message_id: "msg_one", time: 111 })
    expect(JSON.parse(lines[1])).toMatchObject({ message_id: "msg_two", time: 222 })
    expect(JSON.parse(lines[0]).time).not.toBe(JSON.parse(lines[1]).time)
    expect(JSON.parse(lines[0]).message_id).not.toBe(JSON.parse(lines[1]).message_id)
  })

  test("prompt snapshot capture is anchored to the current assistant step", async () => {
    const prompt = await Bun.file(path.join(import.meta.dir, "../../src/session/prompt.ts")).text()
    const call = prompt.match(/captureInjectedSnapshot\(\{[\s\S]*?anchorTime:[\s\S]*?\}\)/)?.[0] ?? ""

    expect(call).toContain("anchorMessageID: msg.id")
    expect(call).toContain("anchorTime: msg.time.created")
    expect(call).not.toContain("anchorMessageID: lastUser.id")
    expect(call).not.toContain("anchorTime: lastUser.time.created")
  })

  test("stores a new content-addressed snapshot when MEMORY.md changes", async () => {
    await using tmp = await tmpdir()
    const memoryRoot = path.join(tmp.path, "memory")
    const projectID = "proj_snapshot" as ProjectID
    const memoryFile = path.join(memoryRoot, "projects", projectID, "MEMORY.md")
    await fs.mkdir(path.dirname(memoryFile), { recursive: true })

    await Bun.write(memoryFile, "memory v1")
    await Effect.runPromise(
      captureInjectedSnapshot({
        sessionID: SessionID.descending("ses_snapshot"),
        instructions: { content: ["Instructions from: C:\\repo\\CLAUDE.md\nclaude body"] },
        memoryRoot,
        projectID,
        anchorMessageID: MessageID.ascending("msg_one"),
        anchorTime: 111,
      }),
    )
    await Bun.write(memoryFile, "memory v2")
    await Effect.runPromise(
      captureInjectedSnapshot({
        sessionID: SessionID.descending("ses_snapshot"),
        instructions: { content: ["Instructions from: C:\\repo\\CLAUDE.md\nclaude body"] },
        memoryRoot,
        projectID,
        anchorMessageID: MessageID.ascending("msg_two"),
        anchorTime: 222,
      }),
    )

    expect(await snapshotFiles(memoryRoot)).toHaveLength(2)
    const lines = await indexLines(memoryRoot)
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).hash).not.toBe(JSON.parse(lines[1]).hash)
  })

  test("gates snapshots to primary main turns only", async () => {
    await using tmp = await tmpdir()
    const memoryRoot = path.join(tmp.path, "memory")
    const projectID = "proj_snapshot" as ProjectID
    const runGatedCapture = async (gate: Parameters<typeof shouldCaptureInjectedSnapshot>[0]) => {
      if (!shouldCaptureInjectedSnapshot(gate)) return
      await Effect.runPromise(
        captureInjectedSnapshot({
          sessionID: SessionID.descending("ses_snapshot"),
          instructions: { content: ["Instructions from: C:\\repo\\CLAUDE.md\nclaude body"] },
          memoryRoot,
          projectID,
          anchorMessageID: MessageID.ascending("msg_gate"),
          anchorTime: 333,
        }),
      )
    }

    expect(shouldCaptureInjectedSnapshot({ agentID: "atlas" })).toBe(false)
    expect(shouldCaptureInjectedSnapshot({ agentID: "explore-1" })).toBe(false)
    expect(shouldCaptureInjectedSnapshot({ parentSessionID: SessionID.descending("ses_parent") })).toBe(false)
    expect(shouldCaptureInjectedSnapshot({ agentID: "main", isolateInstructions: true })).toBe(false)
    expect(shouldCaptureInjectedSnapshot({ agentID: "main" })).toBe(true)
    await runGatedCapture({ agentID: "atlas" })
    await runGatedCapture({ agentID: "explore-1" })
    await runGatedCapture({ parentSessionID: SessionID.descending("ses_parent") })
    expect(await snapshotFiles(memoryRoot)).toHaveLength(0)
  })
})

describe("appealed snapshot resolution", () => {
  test("picks the latest snapshot at or before the audit boundary", () => {
    const rows = [
      { message_id: "msg_1", time: 100, hash: "h1" },
      { message_id: "msg_2", time: 200, hash: "h2" },
      { message_id: "msg_3", time: 300, hash: "h3" },
    ]

    expect(pickAppealedSnapshotHash(rows, 200)).toBe("h2")
    expect(pickAppealedSnapshotHash(rows, 200)).not.toBe("h3")
    expect(pickAppealedSnapshotHash(rows, 250)).toBe("h2")
    expect(pickAppealedSnapshotHash(rows, 50)).toBeUndefined()
    expect(pickAppealedSnapshotHash(rows, 300)).toBe("h3")
    expect(pickAppealedSnapshotHash([], 300)).toBeUndefined()
  })

  test("resolves appealed snapshot paths from index.jsonl and skips bad lines", async () => {
    await using tmp = await tmpdir()
    const memoryRoot = path.join(tmp.path, "memory")
    const sessionID = SessionID.descending("ses_snapshot")
    const index = path.join(memoryRoot, "sessions", sessionID, "injected", "index.jsonl")
    await fs.mkdir(path.dirname(index), { recursive: true })
    await Bun.write(
      index,
      [
        JSON.stringify({ message_id: "msg_1", time: 100, hash: "h1" }),
        "{not json",
        JSON.stringify({ message_id: "msg_bad", time: 250 }),
        JSON.stringify({ message_id: "msg_2", time: 200, hash: "h2" }),
        JSON.stringify({ message_id: "msg_3", time: 300, hash: "h3" }),
      ].join("\n"),
    )

    await expect(Effect.runPromise(resolveAppealedSnapshotPath({ memoryRoot, sessionID, boundary: 200 }))).resolves.toBe(
      path.join(path.dirname(index), "h2.md"),
    )
    await expect(Effect.runPromise(resolveAppealedSnapshotPath({ memoryRoot, sessionID, boundary: 50 }))).resolves.toBeUndefined()
    await expect(Effect.runPromise(resolveAppealedSnapshotPath({ memoryRoot, sessionID, boundary: 300 }))).resolves.toBe(
      path.join(path.dirname(index), "h3.md"),
    )

    await Bun.write(index, "")
    await expect(Effect.runPromise(resolveAppealedSnapshotPath({ memoryRoot, sessionID, boundary: 300 }))).resolves.toBeUndefined()
    await fs.rm(index)
    await expect(Effect.runPromise(resolveAppealedSnapshotPath({ memoryRoot, sessionID, boundary: 300 }))).resolves.toBeUndefined()
  })

  test("renderCommandTemplate replaces appealed snapshot paths without leaving placeholders", () => {
    expect(
      renderCommandTemplate({
        templateCommand: "Appealed snapshot: $APPEALED_SNAPSHOT",
        arguments: "",
        sessionID: SessionID.make("ses_snapshot"),
        appealedSnapshot: "/m/x/h2.md",
      }),
    ).toBe("Appealed snapshot: /m/x/h2.md")

    const empty = renderCommandTemplate({
      templateCommand: "Appealed snapshot: $APPEALED_SNAPSHOT",
      arguments: "",
      sessionID: SessionID.make("ses_snapshot"),
    })
    expect(empty).toBe("Appealed snapshot: ")
    expect(empty).not.toContain("$APPEALED_SNAPSHOT")
  })
})
