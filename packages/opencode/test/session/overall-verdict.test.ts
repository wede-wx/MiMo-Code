import { describe, expect, test } from "bun:test"
import { parseOverallVerdict } from "../../src/session/prompt"

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
