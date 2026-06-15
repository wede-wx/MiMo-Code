import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  evaluateGoalJudgeWithRetry,
  goalJudgeUnavailableContinuation,
} from "../../src/session/prompt"
import type { Goal } from "../../src/session/goal"

const run = <A>(effect: Effect.Effect<A>) => Effect.runPromise(effect)

describe("goalGate judge failure handling", () => {
  test("judge failures exhaust retries and fail closed instead of allowing stop", async () => {
    let calls = 0
    const result = await run(
      evaluateGoalJudgeWithRetry({
        evaluate: () =>
          Effect.gen(function* () {
            calls++
            return yield* Effect.fail(new Error("judge offline"))
          }),
        sleep: () => Effect.void,
      }),
    )

    expect(result.type).toBe("unavailable")
    expect(calls).toBe(3)
    if (result.type !== "unavailable") throw new Error("judge failure unexpectedly produced a verdict")

    const continuation = goalJudgeUnavailableContinuation({
      condition: "tests must pass",
      reason: result.reason,
      attempts: result.attempts,
    })
    expect(continuation.allowStop).toBe(false)
    expect(continuation.clearGoal).toBe(false)
    expect(continuation.continueLoop).toBe(false)
    expect(continuation.text).toContain("<system-reminder>")
    expect(continuation.text).toContain("goal judge")
    expect(continuation.text).toContain("manual")
  })

  test("transient judge failures retry and then follow the successful verdict", async () => {
    let calls = 0
    const result = await run(
      evaluateGoalJudgeWithRetry({
        evaluate: () =>
          Effect.gen(function* () {
            calls++
            if (calls < 3) return yield* Effect.fail(new Error(`temporary ${calls}`))
            return { ok: true, reason: "verified" } satisfies Goal.Verdict
          }),
        sleep: () => Effect.void,
      }),
    )

    expect(calls).toBe(3)
    expect(result).toEqual({
      type: "verdict",
      verdict: { ok: true, reason: "verified" },
      attempts: 3,
    })
  })

  test("normal ok:false verdict does not retry and remains a re-entry verdict", async () => {
    let calls = 0
    const result = await run(
      evaluateGoalJudgeWithRetry({
        evaluate: () =>
          Effect.sync(() => {
            calls++
            return { ok: false, reason: "missing evidence" } satisfies Goal.Verdict
          }),
        sleep: () => Effect.void,
      }),
    )

    expect(calls).toBe(1)
    expect(result).toEqual({
      type: "verdict",
      verdict: { ok: false, reason: "missing evidence" },
      attempts: 1,
    })
  })
})
