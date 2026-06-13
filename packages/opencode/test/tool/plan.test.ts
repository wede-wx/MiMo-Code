import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { Truncate } from "../../src/tool"
import { PlanExitTool } from "../../src/tool/plan"
import { ProviderTest } from "../fake/provider"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await Instance.disposeAll()
})

const question = Layer.succeed(
  Question.Service,
  Question.Service.of({
    ask: Effect.fn("PlanTest.question.ask")(() => Effect.succeed([["Yes"]])),
    reply: Effect.fn("PlanTest.question.reply")(() => Effect.void),
    reject: Effect.fn("PlanTest.question.reject")(() => Effect.void),
    list: Effect.fn("PlanTest.question.list")(() => Effect.succeed([])),
    neverAsk: Effect.fn("PlanTest.question.neverAsk")(() => Effect.succeed(false)),
    setNeverAsk: Effect.fn("PlanTest.question.setNeverAsk")(() => Effect.void),
  }),
)

const provider = ProviderTest.fake()

const it = testEffect(
  Layer.mergeAll(
    Agent.defaultLayer,
    Bus.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    Truncate.defaultLayer,
    question,
    provider.layer,
  ),
)

const ctx = (sessionID: SessionID) => ({
  sessionID,
  messageID: MessageID.ascending(),
  agent: "plan",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

describe("plan exit tool", () => {
  it.live("records the approved plan path in metadata", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const session = yield* Session.Service
          const sess = yield* session.create({ title: "Audit Plan" })
          const info = yield* PlanExitTool
          const tool = yield* info.init()

          const result = yield* tool.execute({}, ctx(sess.id))

          expect(result.metadata.switched).toBe(true)
          expect(result.metadata.plan.replaceAll("\\", "/")).toContain(".mimocode/plans/")
        }),
      { git: true },
    ),
  )
})
