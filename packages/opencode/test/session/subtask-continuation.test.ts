import { describe, expect, test } from "bun:test"
import { subtaskContinuationPrompt } from "../../src/session/prompt"

describe("subtaskContinuationPrompt", () => {
  test("uses neutral continuation wording after atlas audits", () => {
    const text = subtaskContinuationPrompt("atlas")

    expect(text).toContain("Continue with your task")
    expect(text).toContain("Do not restate or summarize the audit verdict")
    expect(text).not.toBe("Summarize the actor tool output above and continue with your task.")
    expect(text).not.toContain("Summarize the actor tool output above")
  })

  test("keeps existing summarize wording for non-atlas command subtasks", () => {
    expect(subtaskContinuationPrompt("distill")).toBe(
      "Summarize the actor tool output above and continue with your task.",
    )
  })
})
