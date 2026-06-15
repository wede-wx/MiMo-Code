import { describe, expect, test } from "bun:test"
import { SessionID } from "../../src/session/schema"
import { appealBoundary, renderCommandTemplate } from "../../src/session/prompt"

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

  test("parses appeal audit boundaries while preserving zero as valid", () => {
    expect(appealBoundary("200")).toBe(200)
    expect(appealBoundary("none")).toBeUndefined()
    expect(appealBoundary(undefined)).toBeUndefined()
    expect(appealBoundary("")).toBeUndefined()
    expect(appealBoundary("200abc")).toBeUndefined()
    expect(appealBoundary("0")).toBe(0)
  })

  test("replaces appeal basis last so user text cannot trigger system placeholders", () => {
    const result = renderCommandTemplate({
      templateCommand: "Adjudicate. Basis: $APPEAL_BASIS. Session $SESSION_ID.",
      arguments: "",
      sessionID: SessionID.make("ses_ABC"),
      appealBasis: "I followed $SESSION_ID rule X",
    })

    expect(result).toContain("Session ses_ABC.")
    expect(result).toContain("Basis: I followed $SESSION_ID rule X")
    expect(result.match(/ses_ABC/g)?.length).toBe(1)
  })

  test("sanitizes appeal basis whitespace and length through command rendering", () => {
    expect(
      renderCommandTemplate({
        templateCommand: "Basis: $APPEAL_BASIS",
        arguments: "",
        sessionID: SessionID.make("ses_basis"),
        appealBasis: "  hello \n world  ",
      }),
    ).toBe("Basis: hello world")

    const clipped = renderCommandTemplate({
      templateCommand: "$APPEAL_BASIS",
      arguments: "",
      sessionID: SessionID.make("ses_basis"),
      appealBasis: "a".repeat(600),
    })
    expect(clipped).toHaveLength(500)
  })

  test("replaces missing appeal basis with an empty string", () => {
    const result = renderCommandTemplate({
      templateCommand: "x $APPEAL_BASIS y",
      arguments: "",
      sessionID: SessionID.make("ses_X"),
    })

    expect(result).toBe("x  y")
    expect(result).not.toContain("$APPEAL_BASIS")
  })
})
