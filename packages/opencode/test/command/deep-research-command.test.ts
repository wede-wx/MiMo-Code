import { describe, expect, test } from "bun:test"
import { Command } from "../../src/command"
import { deepResearchTemplate } from "../../src/command"
import { Effect } from "effect"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("/deep-research command", () => {
  test("Default has the deep-research name", () => {
    expect(Command.Default.DEEP_RESEARCH).toBe("deep-research")
  })

  test("template instructs a run-by-name workflow call weaving in the user args", () => {
    const t = deepResearchTemplate()
    expect(t).toContain("$ARGUMENTS")
    expect(t).toContain('name: "deep-research"')
    expect(t.toLowerCase()).toContain("workflow")
  })
})

describe("/atlas command", () => {
  test("Default has the atlas name", () => {
    expect(Command.Default.ATLAS).toBe("atlas")
  })

  test("registers a clean atlas subtask command with the session id variable", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const command = await Effect.runPromise(
          Command.Service.use((svc) => svc.get("atlas")).pipe(Effect.provide(Command.defaultLayer)),
        )
        expect(command).toBeDefined()
        expect(command?.agent).toBe("atlas")
        expect(command?.subtask).toBe(true)
        expect(command?.source).toBe("command")
        expect(command?.template).toContain("$SESSION_ID")
        expect(command?.template).toContain("$AUDIT_SINCE")
        expect(command?.template).toContain("$INJECTED_SNAPSHOT_INDEX")
        expect(command?.hints).toContain("$AUDIT_SINCE")
        expect(command?.hints).toContain("$INJECTED_SNAPSHOT_INDEX")
      },
    })
  })
})
