import { describe, expect, test } from "bun:test"
import { parseOverallVerdict, subtaskContinuationPrompt } from "../../src/session/prompt"

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

  test("uses parsed atlas verdict output to select rework wording", () => {
    const text = subtaskContinuationPrompt("atlas", parseOverallVerdict("CLAIM: x\nOVERALL_VERDICT: NOT_DONE"))

    expect(text).toContain("OVERALL_VERDICT: NOT_DONE")
    expect(text).toContain("Rework")
  })

  test("does not rework on unreadable atlas verdicts", () => {
    const text = subtaskContinuationPrompt("atlas", "unreadable")

    expect(text).toContain("The audit has been recorded")
    expect(text).not.toContain("NOT_DONE")
    expect(text).not.toContain("Rework")
  })

  test("keeps existing summarize wording for non-atlas command subtasks", () => {
    expect(subtaskContinuationPrompt("distill", "not_done")).toBe(
      "Summarize the actor tool output above and continue with your task.",
    )
  })
})
