<h1 align="center">MiMoCode-Atlas</h1>

<p align="center">
  <img src="assets/readme/mimocode-banner.png" alt="MiMoCode-Atlas" width="700">
</p>

<p align="center"><strong>An honesty-verification fork of Xiaomi MiMoCode.</strong></p>

<p align="center">
  <a href="README.zh.md">中文</a> | English
</p>

<p align="center">
  Upstream official MiMoCode (Xiaomi): <a href="https://mimo.xiaomi.com/en/mimocode">Website</a> | <a href="https://mimo.xiaomi.com/en/blog/mimo-code-long-horizon">Blog</a>
</p>

---

MiMoCode-Atlas is a fork of Xiaomi MiMoCode. It keeps the terminal-native AI coding assistant foundation: reading and writing code, running commands, managing Git, preserving cross-session memory, and rebuilding context for long work.

This fork's main difference is Atlas: an evidence-based honesty-verification loop. When an agent says work is done, Atlas checks the trajectory and file-change evidence instead of trusting the agent's self-report.

---

## Core: Atlas Honesty-Verification Loop

Atlas is built for long coding sessions where "I changed something" is not the same as "the goal is satisfied."

- **Independent auditor (`/atlas`)** - starts as a clean, read-only subagent. It reads the trajectory, tool inputs/outputs, diffs, and ledger evidence, then classifies claims as `DONE`, `NOT DONE`, `UNSUPPORTED`, or out of scope.
- **Audit ledger** - stores the auditor's report in `.mimocode/audit-ledger.md`, preserving what was checked and what evidence supported the verdict.
- **Automatic rework loop** - if the audit returns `NOT_DONE`, the main agent is told to rework; Atlas can re-audit after the rework and stops after a bounded number of attempts.
- **Appeal path** - the main agent can contest a failed audit with an explicit `APPEAL:` line. A separate appeal auditor checks whether the cited evidence really supports the claim.
- **High-fidelity context snapshots** - each main step can capture the injected CLAUDE/AGENTS/MEMORY context version available at that moment, so later audits can verify what the agent actually knew.
- **Structured side-effect traces** - `write`, `edit`, and `bash` record diffs and changed files in tool metadata, so audits can inspect what changed rather than infer from prose.

The goal is simple: make completion claims auditable.

---

## Quick Start

Install this fork from source. Do not use the upstream one-line installer or upstream npm global package if you want this fork; those install Xiaomi's official package, not MiMoCode-Atlas.

```bash
git clone https://github.com/wede-wx/MiMo-Code.git
cd MiMo-Code
bun install
bun run dev
```

You can also run the CLI source entry directly:

```bash
bun run --cwd packages/opencode --conditions=browser src/index.ts
```

### Optional: Windows `mimo` Command

For local convenience on Windows, create `mimo.cmd` or `mimo.ps1` in a directory already on `PATH`, and point it at your local clone.

`mimo.cmd` example:

```bat
@ECHO off
SETLOCAL
SET "MIMOCODE_REPO=C:\path\to\MiMo-Code\packages\opencode"
bun run --cwd "%MIMOCODE_REPO%" --conditions=browser src/index.ts %*
EXIT /b %ERRORLEVEL%
```

`mimo.ps1` example:

```powershell
$mimocodeRepo = "C:\path\to\MiMo-Code\packages\opencode"
& bun run --cwd $mimocodeRepo --conditions=browser src/index.ts @args
exit $LASTEXITCODE
```

Replace `C:\path\to\MiMo-Code` with your own clone path.

---

## Inherited Upstream Capabilities

MiMoCode-Atlas inherits the core MiMoCode foundation from Xiaomi's upstream project:

- Terminal-native agent workflow with code editing, command execution, Git operations, and TUI interaction
- Multiple providers, including custom OpenAI-compatible providers
- Persistent project memory and SQLite FTS search
- Long-context checkpointing and reconstruction
- Subagent orchestration and background work
- Compose workflows, built-in skills, `/dream`, and `/distill`
- Claude/OpenCode/Codex import paths from upstream 0.1.1
- Voice input through Xiaomi MiMo hosted services for logged-in Xiaomi MiMo users

For the full upstream product overview, see the upstream official MiMoCode website and blog linked above.

---

## This Fork's Additions

The Atlas work adds verification and auditability around the inherited agent runtime:

- `/atlas` command for evidence-based session audits
- `/atlas-appeal` flow for contested audit results
- Machine-readable verdict lines for deterministic control flow
- Audit report persistence in `.mimocode/audit-ledger.md`
- Rework orchestration when an audit fails
- Context snapshot indexing for later evidence checks
- Structured file-change metadata for mutating tools
- Guardrails that keep audit agents read-only and instruction-isolated

---

## Development

```bash
bun install              # Install dependencies
bun run dev              # Run this fork in development mode
bun turbo typecheck      # Type check
```

Run package-specific tests from package directories, for example:

```bash
cd packages/opencode
bun test test/session --timeout 30000
```

---

## Upstream Official Resources (Xiaomi)

These resources belong to Xiaomi's upstream MiMoCode/MiMo platform, not this fork. They are kept here so users can find the original project, hosted services, and community.

- **Official MiMoCode website and blog** - linked at the top of this README
- **MiMo Auto / Xiaomi MiMo Platform** - Xiaomi-hosted model access and OAuth login, subject to Xiaomi's own service terms
- **Voice input** - powered by Xiaomi MiMo ASR for MiMo logged-in users
- **Community group chat** - upstream Xiaomi community QR codes below

<p align="center">
  <img src="assets/readme/community-qrcode-1.jpg" alt="Upstream Xiaomi community group chat QR code 1" width="240">
  &nbsp;&nbsp;
  <img src="assets/readme/community-qrcode-2.jpg" alt="Upstream Xiaomi community group chat QR code 2" width="240">
</p>

---

## Relationship to MiMoCode and OpenCode

MiMoCode-Atlas is a fork of [XiaomiMiMo/MiMo-Code](https://github.com/XiaomiMiMo/MiMo-Code), which is itself built as a fork of [OpenCode](https://github.com/anomalyco/opencode).

The upstream MiMoCode layer adds persistent memory, intelligent context management, subagent orchestration, goal-driven autonomous loops, compose workflows, and self-improvement through `/dream` and `/distill`.

This fork keeps that foundation and adds the Atlas honesty-verification loop: audit, ledger, automatic rework, appeals, context snapshots, and structured side-effect evidence.

---

## License and Fork Notice

This project is a fork of XiaomiMiMo/MiMo-Code and keeps the original MIT license and copyright notices in [LICENSE](./LICENSE).

Use of MiMoCode and derivatives is also subject to the upstream [Use Restrictions](./USE_RESTRICTIONS.md).

If you use Xiaomi MiMo-hosted services, including MiMo Auto, Xiaomi MiMo Platform OAuth, MiMo ASR, or other Xiaomi-hosted model services, that use is subject to the [Xiaomi MiMo Terms of Service](https://platform.xiaomimimo.com/docs/terms/user-agreement).

Use of the MiMo name, logo, and trademarks is subject to Xiaomi's MiMo trademark policy.
