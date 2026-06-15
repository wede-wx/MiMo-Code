import { describe, expect, test } from "bun:test"
import { parseAppeal, parseAppealVerdict, parseOverallVerdict } from "../../src/session/prompt"

describe("parseOverallVerdict", () => {
  test("parses final DONE verdict", () => {
    expect(parseOverallVerdict("summary\nOVERALL_VERDICT: DONE")).toBe("done")
  })

  test("parses final NOT_DONE verdict", () => {
    expect(parseOverallVerdict("summary\nOVERALL_VERDICT: NOT_DONE")).toBe("not_done")
  })

  test("fails closed when the verdict line is missing or unreadable", () => {
    for (const output of ["summary only", "OVERALL: done", "OVERALL_VERDICT: maybe"]) {
      const verdict = parseOverallVerdict(output)
      expect(verdict).toBe("unreadable")
      expect(verdict).not.toBe("done")
    }
  })

  test("does not treat prose or tables mentioning NOT DONE as the overall verdict", () => {
    expect(
      parseOverallVerdict(["| NOT DONE | 0 |", "how many NOT DONE: 0", "OVERALL_VERDICT: DONE"].join("\n")),
    ).toBe("done")
  })

  test("uses the last OVERALL_VERDICT line", () => {
    expect(
      parseOverallVerdict(["Quoted earlier:", "OVERALL_VERDICT: NOT_DONE", "", "OVERALL_VERDICT: DONE"].join("\n")),
    ).toBe("done")
  })
})

describe("parseAppeal", () => {
  test("extracts the last non-empty APPEAL basis", () => {
    expect(parseAppeal("APPEAL: evidence is in MEMORY.md rule X")).toBe("evidence is in MEMORY.md rule X")
    expect(parseAppeal(["APPEAL: old basis", "body", "APPEAL: final basis"].join("\n"))).toBe("final basis")
  })

  test("returns undefined when the appeal marker is missing or empty", () => {
    expect(parseAppeal("no appeal here")).toBeUndefined()
    expect(parseAppeal("APPEAL:")).toBeUndefined()
    expect(parseAppeal("APPEAL:     ")).toBeUndefined()
  })
})

describe("parseAppealVerdict", () => {
  test("parses appeal verdicts case-insensitively", () => {
    expect(parseAppealVerdict("APPEAL_VERDICT: UPHELD")).toBe("upheld")
    expect(parseAppealVerdict("APPEAL_VERDICT: rejected")).toBe("rejected")
  })

  test("fails closed when appeal verdict is missing or unreadable", () => {
    for (const output of ["garbage", "APPEAL: evidence", "APPEAL_VERDICT: MAYBE", "APPEAL_VERDICT: UPHELD because"]) {
      const verdict = parseAppealVerdict(output)
      expect(verdict).toBe("unreadable")
      expect(verdict).not.toBe("upheld")
    }
  })

  test("uses the last APPEAL_VERDICT line", () => {
    expect(
      parseAppealVerdict(["Quoted earlier:", "APPEAL_VERDICT: REJECTED", "", "APPEAL_VERDICT: UPHELD"].join("\n")),
    ).toBe("upheld")
  })
})
