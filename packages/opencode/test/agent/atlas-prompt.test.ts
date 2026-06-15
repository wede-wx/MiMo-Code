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

test("atlas appeal prompt defines strict appeal verdicts and remains read-only", async () => {
  const prompt = await Bun.file(path.join(import.meta.dir, "../../src/agent/prompt/atlas-appeal.txt")).text()

  expect(prompt).toContain("APPEAL_VERDICT: UPHELD")
  expect(prompt).toContain("APPEAL_VERDICT: REJECTED")
  expect(prompt).toContain("$APPEALED_SNAPSHOT")
  expect(prompt).toContain("do NOT uphold")
  expect(prompt).toContain("Never uphold to be lenient")
  expect(prompt).toContain("韦鲜")
  expect(prompt).toContain("general assistant")
  expect(prompt).toContain("Read-only")
})
