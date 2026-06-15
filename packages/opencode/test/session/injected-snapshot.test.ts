import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Effect } from "effect"
import { captureInjectedSnapshot, shouldCaptureInjectedSnapshot } from "../../src/session/injected-snapshot"
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
