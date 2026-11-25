# Explore-Compile-Replay (ECR)

<a href="https://discord.gg/WuaCANscr8"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/discord-join-dark.svg"><img src="assets/discord-join-light.svg" alt="Join us on Discord" width="160" height="54"></picture></a>

**An agent explores your app once. What it did becomes a standard test. The test reruns in CI with no model.**

**[How it works](#how-it-works)** · **[Quick start](#quick-start)** · **[The command](docs/command.md)** · **[Write an adapter](docs/adapter.md)** · **[Seven laws](spec/laws.md)** · **[Status](docs/status.md)**

AI agents are good at finding what nobody thought to test. They are also slow,
they cost money on every run, and they never take the same path twice, so they
do not fit in CI. Explore-Compile-Replay keeps the first part and removes the
rest: the agent runs once, and its path is kept as a plain test file that anyone
can read, review and run.

> **Early draft, opened on 24 November 2026.** It runs end to end on a toy system and on a demo mobile app. No real app is supported yet. [What works today](#what-works-today) says where it stands.

[![CI](https://github.com/pierridotite/explore-compile-replay/actions/workflows/ci.yml/badge.svg)](https://github.com/pierridotite/explore-compile-replay/actions/workflows/ci.yml)
[![Stars](https://img.shields.io/github/stars/pierridotite/explore-compile-replay?style=flat)](https://github.com/pierridotite/explore-compile-replay/stargazers)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-green)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/pierridotite/explore-compile-replay)](https://github.com/pierridotite/explore-compile-replay/commits/main)
[![Discord](https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/WuaCANscr8)

## How it works

1. **Explore.** An agent plays a persona and uses the system once. Each action and each check is recorded in a typed trace.
2. **Compile.** The trace becomes a standard test file: a [Maestro](https://maestro.dev) flow for a mobile app today, a Playwright test for a web app next. It runs without ECR.
3. **Replay.** The file runs in CI. No model, no tokens, the same verdict every time.

```mermaid
flowchart LR
  E["Explore<br/>an agent, once"] --> T["Trace<br/>typed, validated"]
  T --> C[Compile]
  C --> A["Test file<br/>runs without ECR"]
  A --> R["Replay in CI<br/>no model"]
  R -- the app changed --> H["Repair<br/>bounded"]
  H -- accepted patch --> C
```

When the app changes and a replay breaks on a step, your agent proposes a new action for that step and a bounded **repair** accepts it or refuses it. A repair may change how a step finds its target. It can never change what the test checks: when a check fails, a person decides whether it is a regression or an intended change.

## One step, from trace to test

A step of a trace, as an exploration recorded it (shortened):

```json
{
  "id": "s8",
  "action": { "kind": "tapOn", "target": { "text": "Save" } },
  "checkpoints": [
    { "id": "item-listed", "check": { "kind": "visible", "target": { "text": { "param": "ITEM_TITLE" } } } }
  ]
}
```

What it compiles to:

```yaml
# Step s8
- tapOn:
    text: "Save"
# Oracle item-listed
- assertVisible:
    text: "${ITEM_TITLE}"
```

The tap is stored by the name of the button, not by its place on the screen. The text that was typed is stored by its name, `ITEM_TITLE`, never by its value: the value is given when the test runs. The whole example: [the trace](packages/adapter-maestro/examples/anna-first-item-mobile.trace.json) and [the flow](packages/adapter-maestro/examples/anna-first-item-mobile.flow.yaml).

## Quick start

You need Node 22.18 or later and pnpm. Nothing is on npm yet: it runs from a clone.

```sh
git clone https://github.com/pierridotite/explore-compile-replay && cd explore-compile-replay
pnpm install
pnpm check     # types, tests and the conformance report

export ECR_PARAM_ITEM_TITLE="Buy bread" ECR_PARAM_PRIVATE_NOTE="Door code 4821"
pnpm ecr replay packages/adapter-fixture/examples/anna-first-item.trace.json \
  --adapter packages/adapter-fixture/src/index.ts
# pass  anna-first-item (node-test, 80 ms)
```

That replays a recorded trace against a to-do list in memory, the reference system. Validating, compiling, repairing and the report of the laws: [docs/command.md](docs/command.md).

## Where it is used: mobile-agent-testers

[mobile-agent-testers](https://github.com/pierridotite/mobile-agent-testers) gives one phone to each AI tester, on GitHub's runners, and each tester reports the bugs it finds. It is the first project that writes ECR traces:

- Each Android tester leaves its path as a trace, next to its report.
- With one option, the path is compiled and replayed on the same phone right after the agent, with no model.
- On its [map of the app's screens](https://pierridotite.github.io/mobile-agent-testers/), a finding of a tester becomes a check of the trace in two clicks.

So far this ran on its demo app, on an Android emulator. Of four paths explored by an agent, two stopped on a step, and the last two, of 37 and 25 steps, replayed in full with no model. How it is wired: [docs/replay.md](https://github.com/pierridotite/mobile-agent-testers/blob/main/docs/replay.md).

## A bug is a test too

An agent that explores finds bugs. A report describes them. A trace holds them as checks: what should be true is recorded with `"observed": "failed"`, and it compiles to a test that is red until the bug is fixed. A replay then gives one of four results.

| Result | Meaning |
|---|---|
| `pass` | Every check holds |
| `bug` | The replay stops on the bug the trace records, and on nothing else. The bug is still there |
| `fixed` | The check that was recorded as a bug holds now. It becomes a guard |
| `FAIL` | Anything else: a step no longer finds its target, or a check that held no longer holds |

The rules and an example: [docs/command.md](docs/command.md#a-bug-is-a-test-too).

## Seven laws

An adapter connects ECR to one kind of system: a mobile app, a web app, an API. It is correct when it obeys seven laws, and a conformance kit checks them, so that anyone can write an adapter and show that it works. Full text: [spec/laws.md](spec/laws.md).

| | Law | In short |
|---|---|---|
| L1 | Determinism | The same trace compiles to the same bytes. The same file gives the same verdict |
| L2 | Fidelity | The file runs the actions and the checks of the trace, in the same order |
| L3 | Traceability | Each step of the trace maps to one distinct range of the file |
| L4 | No model | Compiling and replaying call no model |
| L5 | State | A saved state, once restored, is observed as identical, when the adapter can save one |
| L6 | Safe repair | A patch stays inside the failing step, and removes or weakens no check |
| L7 | No secret | Neither the trace nor the file contains a secret value |

The shape of an adapter and the choices behind it: [docs/adapter.md](docs/adapter.md).

## What works today

- The trace format, the adapter contract and the seven laws, as drafts: [spec/](spec/).
- The `ecr` command: `validate`, `compile`, `replay`, `repair`, `conformance`.
- A reference adapter, a to-do list in memory compiled to a plain `node:test` file. The kit passes it on L1, L2, L3, L5 and L7, on L4 with the network closed, and on part of L6.
- A mobile adapter that compiles to Maestro flows, replayed on an Android emulator against a demo app: [packages/adapter-maestro](packages/adapter-maestro/README.md).
- A bounded repair, tried on the reference adapter.

Not yet:

- A real app. A first one, [LocalSend](https://github.com/localsend/localsend), is being tried now. How it will be measured was written first: [paper/protocol.md](paper/protocol.md).
- iOS, and a web adapter that compiles to Playwright tests.
- Exploring through ECR itself: an MCP server and skills for your agent. Today the trace is written by the tool that drives the agent.
- A repair on a device, and a package on npm.

Part by part: [docs/status.md](docs/status.md).

## Where it comes from

ECR generalizes [mobile-agent-testers](https://github.com/pierridotite/mobile-agent-testers). Two of its runs never take the same path, so when a tester finds a bug, the path that led to it is worth keeping, as a test that runs for free.

The shape of the idea comes from [Remotion](https://www.remotion.dev), where a video is code: an AI writes that code once, and every render gives the same video with no model. ECR does the same for tests: the agent explores once, and the replay is the render.

ECR does not claim to be first. Several tools already keep or replay what an agent did, each for its own system: [Stagehand](https://github.com/browserbase/stagehand), [Skyvern](https://github.com/Skyvern-AI/skyvern), [workflow-use](https://github.com/browser-use/workflow-use), [Midscene](https://github.com/web-infra-dev/midscene), [Arbigent](https://github.com/takahirom/arbigent), [muscle-mem](https://github.com/pig-dot-dev/muscle-mem) and [autocompile](https://github.com/mirkokiefer/autocompile). What this project adds is a name for the pattern and a written contract for it: one that works across systems, compiles to files that run without the tool, protects what the tests check, and can be verified by a conformance kit.

## What comes next

Targets, not promises.

- The evaluation on LocalSend: cost, stability of the replays, and what happens when the app changes.
- A repair on a device.
- An MCP server and skills, so that your own agent explores through ECR.
- A web adapter with Playwright, then a first version on npm.

## Feedback

The contract is the thing to challenge right now. If you maintain a test tool or an agent framework, or if you would write an adapter, [open an issue](https://github.com/pierridotite/explore-compile-replay/issues/new) and say what would not fit your system.

To talk it through, or to follow the work as it happens, join the [Discord](https://discord.gg/WuaCANscr8). It is shared with mobile-agent-testers.

To cite this work: [CITATION.cff](CITATION.cff).

Made by [@pierridotite](https://github.com/pierridotite) ([LinkedIn](https://www.linkedin.com/in/pierre-raffalli/)) · [Apache-2.0](LICENSE)
