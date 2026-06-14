import { describe, expect, test } from "bun:test"
import {
  atlasAuditAttemptFromDescription,
  encodeAtlasAuditAttemptDescription,
  parseOverallVerdict,
  shouldTriggerAtlasReaudit,
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
    expect(decision.reworkAttempt).toBeUndefined()
  })

  test("keeps existing summarize wording for non-atlas command subtasks", () => {
    expect(subtaskContinuationPrompt("distill", "not_done")).toBe(
      "Summarize the actor tool output above and continue with your task.",
    )
  })
})

describe("atlas audit rework orchestration helpers", () => {
  test("encodes and decodes atlas audit attempt from subtask description", () => {
    const description = encodeAtlasAuditAttemptDescription("audit the current session", 2)

    expect(description).toContain("[atlas-audit-attempt:2]")
    expect(atlasAuditAttemptFromDescription(description)).toBe(2)
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
