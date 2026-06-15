import { expect, test } from "bun:test"
import path from "path"

test("atlas overall verdict treats unsupported claims as not passed while leaving N/A out of scope", async () => {
  const prompt = await Bun.file(path.join(import.meta.dir, "../../src/agent/prompt/atlas.txt")).text()

  expect(prompt).toContain("If any CLAIM has VERDICT: NOT DONE or UNSUPPORTED, write OVERALL_VERDICT: NOT_DONE.")
  expect(prompt).toContain("UNSUPPORTED means the trajectory lacks support")
  expect(prompt).toContain("N/A remains outside auditable scope and does not trigger OVERALL_VERDICT: NOT_DONE.")
  expect(prompt).not.toContain("reports with UNSUPPORTED or N/A claims but no NOT DONE claims")
  expect(prompt).not.toContain("UNSUPPORTED and N/A are not NOT_DONE")
})
