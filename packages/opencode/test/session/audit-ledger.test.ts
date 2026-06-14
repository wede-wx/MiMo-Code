import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import path from "path"
import { AppFileSystem } from "@mimo-ai/shared/filesystem"
import { Database, count } from "../../src/storage"
import { MessageTable, PartTable, SessionTable } from "../../src/session/session.sql"
import { ProjectTable } from "../../src/project/project.sql"
import { writeAuditLedgerEntry } from "../../src/session/prompt"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Instance } from "../../src/project/instance"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"

afterEach(async () => {
  Database.use((db) => {
    db.delete(PartTable).run()
    db.delete(MessageTable).run()
    db.delete(SessionTable).run()
    db.delete(ProjectTable).run()
  })
  await Instance.disposeAll()
})

const it = testEffect(Layer.mergeAll(AppFileSystem.defaultLayer, CrossSpawnSpawner.defaultLayer))

const now = new Date("2026-06-15T01:02:03.004Z")
const sessionID = SessionID.make("ses_audit_ledger")
const anchor = PartID.make("prt_audit_anchor")
const output = [
  "CLAIM:    I ran tests",
  "EVIDENCE: command output included exit 0",
  "VERDICT:  DONE",
  "",
  "CLAIM:    diff exists",
  "EVIDENCE: metadata.diff=<DIFFTEXT>",
  "VERDICT:  DONE",
].join("\n")

function seedSession() {
  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: "proj_audit_ledger" as any,
        worktree: "/tmp/audit-ledger",
        sandboxes: [] as any,
        time_created: now.getTime(),
        time_updated: now.getTime(),
      })
      .run()
    db.insert(SessionTable)
      .values({
        id: sessionID,
        project_id: "proj_audit_ledger" as any,
        slug: "audit-ledger",
        directory: "/tmp/audit-ledger",
        title: "Audit Ledger",
        version: "1",
        time_created: now.getTime(),
        time_updated: now.getTime(),
      })
      .run()
    db.insert(MessageTable)
      .values({
        id: MessageID.make("msg_audit_ledger"),
        session_id: sessionID,
        agent_id: "main",
        data: { role: "assistant" } as any,
        time_created: now.getTime(),
        time_updated: now.getTime(),
      })
      .run()
    db.insert(PartTable)
      .values({
        id: anchor,
        message_id: MessageID.make("msg_audit_ledger"),
        session_id: sessionID,
        data: { type: "tool", tool: "actor" } as any,
        time_created: now.getTime(),
        time_updated: now.getTime(),
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

describe("audit ledger persistence", () => {
  it.live("appends atlas output verbatim with anchors without mutating message or part rows", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        seedSession()
        const fsys = yield* AppFileSystem.Service
        const ledger = path.join(dir, ".mimocode", "audit-ledger.md")
        const before = tableCounts()

        expect(yield* fsys.existsSafe(ledger)).toBe(false)
        yield* writeAuditLedgerEntry({
          fsys,
          projectRoot: dir,
          sessionID,
          anchor,
          output,
          now,
        })

        const content = yield* fsys.readFileString(ledger)
        expect(content).toContain("## 2026-06-15T01:02:03.004Z · session ses_audit_ledger")
        expect(content).toContain("- anchor: prt_audit_anchor")
        expect(content).toContain("- 复审: audit_trajectory(session_id=ses_audit_ledger)")
        expect(content).toContain(output)
        expect(content).toContain("\n---\n")
        expect(tableCounts()).toEqual(before)
      }),
    ),
  )

  it.live("does not write for non-atlas subtasks", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const fsys = yield* AppFileSystem.Service
        const ledger = path.join(dir, ".mimocode", "audit-ledger.md")
        yield* writeAuditLedgerEntry({
          fsys,
          projectRoot: dir,
          sessionID,
          anchor,
          output,
          command: "dream",
          now,
        })
        expect(yield* fsys.existsSafe(ledger)).toBe(false)
      }),
    ),
  )

  it.live("appends multiple atlas records without overwriting previous entries", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const fsys = yield* AppFileSystem.Service
        const ledger = path.join(dir, ".mimocode", "audit-ledger.md")

        yield* writeAuditLedgerEntry({ fsys, projectRoot: dir, sessionID, anchor, output: "FIRST REPORT", now })
        yield* writeAuditLedgerEntry({ fsys, projectRoot: dir, sessionID, anchor, output: "SECOND REPORT", now })

        const content = yield* fsys.readFileString(ledger)
        expect(content.match(/^## /gm)?.length).toBe(2)
        expect(content).toContain("FIRST REPORT")
        expect(content).toContain("SECOND REPORT")
        expect(content.indexOf("FIRST REPORT")).toBeLessThan(content.indexOf("SECOND REPORT"))
      }),
    ),
  )
})
