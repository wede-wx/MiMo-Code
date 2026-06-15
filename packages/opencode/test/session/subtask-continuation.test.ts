import { describe, expect, test } from "bun:test"
import { COMMAND_INTERNAL_SUBAGENT_TYPES, SYSTEM_SPAWNED_AGENT_TYPES } from "../../src/agent/config"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID } from "../../src/session/schema"
import {
  atlasAuditAttemptFromDescription,
  atlasAppealAfterMessage,
  atlasAuditSinceFromDescription,
  atlasCommandAuditDescription,
  atlasReauditDescription,
  encodeAtlasAuditAttemptDescription,
  encodeAtlasAuditSince,
  parseOverallVerdict,
  shouldTriggerAtlasReaudit,
  subtaskAppealDecision,
  subtaskContinuationDecision,
  subtaskContinuationPrompt,
} from "../../src/session/prompt"

describe("subtaskContinuationPrompt", () => {
  test("uses neutral continuation wording after atlas audits", () => {
    const text = subtaskContinuationPrompt("atlas", "done")

    expect(text).toContain("Continue with your task")
    expect(text).toContain("Do not restate or summarize the audit verdict")
    expect(text).not.toBe("Summarize the actor tool output above and continue with your task.")
    expect(text).not.toContain("Summarize the actor tool output above")
  })

  test("injects rework wording only for atlas NOT_DONE verdicts", () => {
    const text = subtaskContinuationPrompt("atlas", "not_done")

    expect(text).toContain("APPEAL:")
    expect(text).toContain("NOT_DONE")
    expect(text).toContain("Rework")
    expect(text).toContain("Continue with your task")
    expect(text).toContain("Do not restate or summarize the audit verdict")
    expect(text).not.toContain("Summarize the actor tool output above")
  })

  test("increments the rework attempt for atlas NOT_DONE verdicts below the cap", () => {
    const decision = subtaskContinuationDecision("atlas", "not_done", 2)

    expect(decision.kind).toBe("rework")
    expect(decision.reworkAttempt).toBe(3)
    expect(decision.text).toContain("Rework")
  })

  test("uses parsed atlas verdict output to select rework wording", () => {
    const text = subtaskContinuationPrompt("atlas", parseOverallVerdict("CLAIM: x\nOVERALL_VERDICT: NOT_DONE"))

    expect(text).toContain("OVERALL_VERDICT: NOT_DONE")
    expect(text).toContain("Rework")
  })

  test("does not rework on unreadable atlas verdicts", () => {
    const text = subtaskContinuationPrompt("atlas", "unreadable")

    expect(text).toContain("could not be read")
    expect(text).not.toContain("NOT_DONE")
    expect(text).not.toContain("Rework")
  })

  test("gives up after the third failed atlas audit", () => {
    const decision = subtaskContinuationDecision("atlas", "not_done", 3)

    expect(decision.kind).toBe("give_up")
    expect(decision.text).toContain("3 rework attempts")
    expect(decision.text).not.toContain("APPEAL:")
    expect(decision.reworkAttempt).toBeUndefined()
  })

  test("keeps existing summarize wording for non-atlas command subtasks", () => {
    expect(subtaskContinuationPrompt("distill", "not_done")).toBe(
      "Summarize the actor tool output above and continue with your task.",
    )
  })
})

describe("atlas audit rework orchestration helpers", () => {
  test("maps atlas appeal verdicts into the audit continuation state machine", () => {
    expect(subtaskAppealDecision("upheld", 1).kind).toBe("done")

    expect(subtaskAppealDecision("rejected", 0)).toMatchObject({ kind: "rework", reworkAttempt: 1 })
    expect(subtaskAppealDecision("rejected", 2)).toMatchObject({ kind: "rework", reworkAttempt: 3 })
    expect(subtaskAppealDecision("rejected", 3).kind).toBe("give_up")

    expect(subtaskAppealDecision("unreadable", 1).kind).toBe("unreadable")
    expect(subtaskAppealDecision("unreadable", 1).kind).not.toBe("done")
    expect(subtaskAppealDecision().kind).toBe("unreadable")
    expect(subtaskAppealDecision().kind).not.toBe("done")
    expect(subtaskAppealDecision("rejected", 2)).toEqual(subtaskContinuationDecision("atlas", "not_done", 2))
  })

  test("encodes and decodes atlas audit attempt from subtask description", () => {
    const description = encodeAtlasAuditAttemptDescription("audit the current session", 2)

    expect(description).toContain("[atlas-audit-attempt:2]")
    expect(atlasAuditAttemptFromDescription(description)).toBe(2)
  })

  test("encodes and decodes atlas audit since boundaries without disturbing attempt markers", () => {
    expect(encodeAtlasAuditSince("", "200")).toBe("[atlas-audit-since:200]")
    expect(encodeAtlasAuditSince("audit the current session", "200")).toBe("audit the current session [atlas-audit-since:200]")
    expect(encodeAtlasAuditSince("audit the current session", "none")).toContain("[atlas-audit-since:none]")
    expect(encodeAtlasAuditSince("audit [atlas-audit-since:100]", "200")).toBe("audit [atlas-audit-since:200]")

    const withAttempt = encodeAtlasAuditSince("audit [atlas-audit-attempt:2]", "200")
    expect(withAttempt).toContain("[atlas-audit-attempt:2]")
    expect(withAttempt).toContain("[atlas-audit-since:200]")
    expect(atlasAuditAttemptFromDescription(withAttempt)).toBe(2)
    expect(atlasAuditSinceFromDescription(withAttempt)).toBe("200")
  })

  test("reads atlas audit since boundaries and keeps them separate from attempt markers", () => {
    expect(atlasAuditSinceFromDescription("audit [atlas-audit-since:200]")).toBe("200")
    expect(atlasAuditSinceFromDescription("audit [atlas-audit-since:none]")).toBe("none")
    expect(atlasAuditSinceFromDescription("audit the current session")).toBeUndefined()
    expect(atlasAuditSinceFromDescription("audit [atlas-audit-attempt:2] [atlas-audit-since:300]")).toBe("300")
    expect(atlasAuditSinceFromDescription(encodeAtlasAuditSince("x", "200"))).toBe("200")
  })

  test("builds atlas re-audit descriptions with attempt and same-source since markers", () => {
    const description = atlasReauditDescription("audit the current session", 2, "300")

    expect(description).toContain("[atlas-audit-attempt:2]")
    expect(description).toContain("[atlas-audit-since:300]")
    expect(atlasAuditAttemptFromDescription(description)).toBe(2)
    expect(atlasAuditSinceFromDescription(description)).toBe("300")
  })

  test("builds manual atlas command descriptions with since only and leaves non-atlas commands unchanged", () => {
    const atlas = atlasCommandAuditDescription("atlas", "audit the current session", "none")

    expect(atlas).toContain("[atlas-audit-since:none]")
    expect(atlas).not.toContain("[atlas-audit-attempt:")
    expect(atlasAuditAttemptFromDescription(atlas)).toBe(0)
    expect(atlasAuditSinceFromDescription(atlas)).toBe("none")
    expect(atlasCommandAuditDescription("distill", "distill current session", undefined)).toBe("distill current session")
    expect(atlasCommandAuditDescription("distill", "distill current session", "400")).toBe("distill current session")
  })

  test("detects whether an atlas appeal subtask already exists after a message", () => {
    const msg = (id: string, parts: MessageV2.Part[] = []) =>
      ({ info: { id: MessageID.ascending(id) }, parts }) as MessageV2.WithParts
    const appealPart = {
      type: "subtask",
      command: "atlas-appeal",
      description: "appeal",
      agent: "atlas-appeal",
      prompt: "appeal",
    } as MessageV2.SubtaskPart

    expect(atlasAppealAfterMessage([msg("msg_one"), msg("msg_two", [appealPart])], MessageID.ascending("msg_one"))).toBe(true)
    expect(atlasAppealAfterMessage([msg("msg_one"), msg("msg_two")], MessageID.ascending("msg_one"))).toBe(false)
    expect(atlasAppealAfterMessage([msg("msg_one"), msg("msg_two", [appealPart])], MessageID.ascending("msg_missing"))).toBe(false)
  })

  test("derives appeal audit boundary and attempt from the appealed atlas description", () => {
    const description = atlasReauditDescription("audit the current session", 2, "200")

    expect(atlasAuditSinceFromDescription(description)).toBe("200")
    expect(atlasAuditAttemptFromDescription(description)).toBe(2)
  })

  test("registers atlas appeal as system-spawned and command-internal while preserving atlas", () => {
    expect(COMMAND_INTERNAL_SUBAGENT_TYPES.has("atlas")).toBe(true)
    expect(COMMAND_INTERNAL_SUBAGENT_TYPES.has("atlas-appeal")).toBe(true)
    expect(SYSTEM_SPAWNED_AGENT_TYPES.has("atlas")).toBe(true)
    expect(SYSTEM_SPAWNED_AGENT_TYPES.has("atlas-appeal")).toBe(true)
  })

  test("treats manual atlas subtasks without an attempt marker as attempt zero", () => {
    expect(atlasAuditAttemptFromDescription("audit the current session trajectory with a clean read-only subagent")).toBe(0)
  })

  test("schedules exactly one reaudit after main answers a rework message", () => {
    expect(shouldTriggerAtlasReaudit({ reworkAttempt: 1, mainAnswered: true, existingAuditAttempts: [] })).toBe(1)
    expect(shouldTriggerAtlasReaudit({ reworkAttempt: 1, mainAnswered: true, existingAuditAttempts: [1] })).toBeUndefined()
    expect(shouldTriggerAtlasReaudit({ reworkAttempt: 1, mainAnswered: false, existingAuditAttempts: [] })).toBeUndefined()
  })

  test("does not schedule reaudit for unreadable/give-up terminal decisions", () => {
    expect(subtaskContinuationDecision("atlas", "unreadable", 1).kind).toBe("unreadable")
    expect(subtaskContinuationDecision("atlas", "unreadable", 1).reworkAttempt).toBeUndefined()
    expect(shouldTriggerAtlasReaudit({ reworkAttempt: undefined, mainAnswered: true, existingAuditAttempts: [] })).toBeUndefined()
  })
})
