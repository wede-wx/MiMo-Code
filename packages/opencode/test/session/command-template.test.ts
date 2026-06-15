import { describe, expect, test } from "bun:test"
import { SessionID } from "../../src/session/schema"
import { renderCommandTemplate } from "../../src/session/prompt"

describe("renderCommandTemplate", () => {
  test("replaces $AUDIT_SINCE with the derived epoch boundary", () => {
    const result = renderCommandTemplate({
      templateCommand: "Audit $SESSION_ID since $AUDIT_SINCE: $ARGUMENTS",
      arguments: "claim text",
      sessionID: SessionID.make("ses_audit"),
      auditSince: "1700000000123",
    })

    expect(result).toBe("Audit ses_audit since 1700000000123: claim text")
  })

  test("replaces $AUDIT_SINCE with none when no prior successful audit exists", () => {
    const result = renderCommandTemplate({
      templateCommand: "Audit $SESSION_ID since $AUDIT_SINCE",
      arguments: "",
      sessionID: SessionID.make("ses_first"),
      auditSince: "none",
    })

    expect(result).toBe("Audit ses_first since none")
  })

  test("replaces $INJECTED_SNAPSHOT_INDEX with the resolved snapshot index path", () => {
    const result = renderCommandTemplate({
      templateCommand: "Read injected snapshots from $INJECTED_SNAPSHOT_INDEX",
      arguments: "",
      sessionID: SessionID.make("ses_snapshot"),
      injectedSnapshotIndex: "C:\\data\\memory\\sessions\\ses_snapshot\\injected\\index.jsonl",
    })

    expect(result).toBe("Read injected snapshots from C:\\data\\memory\\sessions\\ses_snapshot\\injected\\index.jsonl")
  })
})
