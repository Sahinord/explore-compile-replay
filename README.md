# Explore-Compile-Replay (ECR)

**Let an agent explore your system once. Compile what it did into a standard test. Replay it in CI with no model.**

> **Status: early draft, opened on 24 November 2026.** The contract is being written in the open. A first slice runs end to end, on a toy system only: no real app is supported yet. What exists today is listed [below](#what-exists-today).

LLM agents are good at finding what nobody thought to test. They are also slow, they cost money on every run, and they never take the same path twice. That makes them a poor fit for CI.

Explore-Compile-Replay is a pattern that keeps the first property and removes the others:

1. **Explore.** An agent plays a persona and uses the system once. Each action and each check is recorded in a typed trace.
2. **Compile.** The trace becomes a standard artifact: a Playwright test, a Maestro flow. It is a plain file you can read, review and run without ECR.
3. **Replay.** The artifact runs in CI. No model, no tokens, the same verdict every time.

When the system changes and a replay breaks, a bounded **repair** step proposes a patch as a pull request. It may fix how a step finds its target. It may never change what the test checks: if a check fails, a person decides whether it is a regression or an intended change.

```mermaid
flowchart LR
  P([Persona]) -.-> E
  I([Invariants]) -.-> T
  E["Explore<br/>an agent, once"] --> T["Trace<br/>typed, validated"]
  T --> C[Compile]
  C --> A["Artifact<br/>Playwright test, Maestro flow"]
  A --> R["Replay in CI<br/>no model"]
  R -- drift --> H["Repair<br/>bounded"]
  H -- patch as a PR --> C
```

## The contract

An adapter connects ECR to one kind of system: a web app, a mobile app, an API. It is three small pieces, not one large interface.

A sketch of what an adapter will look like. Nothing is published on npm yet.

```ts
import { defineAdapter } from "explore-compile-replay";

export default defineAdapter({
  id: "my-system",

  // 1. Two typed vocabularies: what an agent may do, what a test may check.
  actions, // e.g. tap, type, navigate
  oracles, // e.g. visible, equals. Deterministic checks, stored as data.

  // 2. A driver for the live system. Used to explore and to repair, never to replay.
  driver: {
    capabilities: { snapshot: true },
    setup, teardown,
    observe, // the state, and whether it is stable yet
    execute, // one action
    verify,  // one oracle, with no model call
    snapshot, restore,
  },

  // 3. One target per artifact format. It compiles, then runs the native tool.
  targets: [
    {
      id: "playwright",
      compile, // pure: trace in, file and source map out
      replay,  // runs the file, reports typed divergences
    },
  ],
});
```

The draft types are in [`spec/contract.ts`](spec/contract.ts) and the data shapes in [`spec/schema.ts`](spec/schema.ts). An example trace is in [`spec/examples/`](spec/examples/).

## Seven laws

An adapter is correct when it obeys seven laws. A conformance kit checks them, so that anyone can write an adapter and prove it works. The kit covers four laws today and says so for the others. Full text: [`spec/laws.md`](spec/laws.md).

| | Law | In short |
|---|---|---|
| L1 | Determinism | The same trace compiles to the same bytes. The same artifact gives the same verdict. |
| L2 | Fidelity | The artifact runs the actions and checks the oracles of the trace, in the same order. |
| L3 | Traceability | Each step of the trace maps to one distinct range of the artifact. |
| L4 | No model | Compiling and replaying call no model. |
| L5 | State | `restore(snapshot())` brings back an identical observed state, when the adapter declares it. |
| L6 | Safe repair | A patch stays inside the range of the failing step, and removes or weakens no oracle. |
| L7 | No secret | Neither the trace nor the artifact contains a secret value. |

## Design choices

- **The artifact is a standard file.** If you stop using ECR, your tests still run.
- **No built-in LLM loop.** Exploring is done by the agent you already use, through an MCP server and skills. ECR records, validates and compiles.
- **The core will never import an LLM SDK.** A replay cannot call a model by accident.
- **Oracles are data.** Every target can emit them, and a repair can prove it removed none.

## What exists today

| Part | Status |
|---|---|
| Trace schema, [`spec/schema.ts`](spec/schema.ts) | Draft. Type-checked, with a validated example and a generated [JSON Schema](spec/trace.schema.json). A step may carry evidence (a screenshot, where the finger landed) for tools that show a trace |
| Adapter contract, [`spec/contract.ts`](spec/contract.ts) | Draft. Type-checked |
| Seven laws, [`spec/laws.md`](spec/laws.md) | Draft |
| Core, [`packages/core`](packages/core/src/index.ts) | First slice: record a trace through a driver, validate it, hash it, resolve parameters, check a source map |
| `ecr` command, [`packages/cli`](packages/cli/src/run.ts) | Runs from this repository: `validate`, `compile`, `replay`, `conformance`. Not on npm yet |
| MCP server and skills, for an agent to explore | Not started |
| Reference adapter, [`packages/adapter-fixture`](packages/adapter-fixture/src/adapter.ts) | Runs. A to-do list in memory, compiled to a plain `node:test` file |
| Conformance kit, [`packages/conformance`](packages/conformance/src/index.ts) | First slice. Checks L1, L3, L5 and L7, part of L2 and L4. L6 waits for repair |
| Repair | Not started |
| Mobile adapter, [`packages/adapter-maestro`](packages/adapter-maestro/README.md) | Draft. A mobile vocabulary and a compiler to [Maestro](https://maestro.dev) flows. Checked for syntax, not yet run on a device. No driver, no typed divergences yet |
| Web adapter, compiling to Playwright tests | Planned |
| Drift benchmark: does a replay break, repair, or stay red when it should? | Planned |
| Paper | Planned |

### Try it

You need Node 22.18 or later and pnpm.

```sh
pnpm install
pnpm check        # types, schema, examples, tests, conformance
pnpm conformance  # the report alone
```

The report for the reference adapter:

```text
L1  Determinism   pass     same bytes on two compilations, same verdict on 3 replays (1 trace, 1 target)
L2  Fidelity      partial  recorded traces replay green; the order of actions on an instrumented system is not checked yet
L3  Traceability  pass     every step has one range, inside the file, with no overlap (1 trace, 1 target)
L4  No model      partial  no artifact imports a known model SDK; replaying with the network closed is not checked yet
L5  State         pass     state identical after restore (1 trace)
L6  Safe repair   skipped  repair is not implemented yet
L7  No secret     pass     1 secret value searched in traces and artifacts, none found
```

"partial" and "skipped" are not passes. They mark what the kit cannot prove yet.

To see the three steps on one example, read these two files side by side:

- the trace an exploration recorded: [`anna-first-item.trace.json`](packages/adapter-fixture/examples/anna-first-item.trace.json)
- the test it compiles to: [`anna-first-item.test.mjs`](packages/adapter-fixture/examples/anna-first-item.test.mjs). It imports nothing from this project, and it holds the names of its parameters, never their values.

The same for a mobile app: [a trace](packages/adapter-maestro/examples/anna-first-item-mobile.trace.json) and [the Maestro flow](packages/adapter-maestro/examples/anna-first-item-mobile.flow.yaml) it compiles to.

The tests replay that file against two changed versions of the system. A new behaviour comes back as a failed oracle. A target that moved comes back as `target_not_found` on its step.

### The `ecr` command

It runs from this repository for now. Compiling and replaying call no model.

```sh
TRACE=packages/adapter-fixture/examples/anna-first-item.trace.json
ADAPTER=packages/adapter-fixture/src/index.ts

pnpm ecr validate $TRACE --adapter $ADAPTER          # schema, then the adapter's vocabularies
pnpm ecr compile $TRACE --adapter $ADAPTER --check   # is the compiled file up to date? For CI

export ECR_PARAM_ITEM_TITLE="Buy bread" ECR_PARAM_PRIVATE_NOTE="Door code 4821"
pnpm ecr replay $TRACE --adapter $ADAPTER            # pass  anna-first-item (node-test, 80 ms)
pnpm ecr conformance $TRACE --adapter $ADAPTER       # the report above, for any adapter
```

A trace stores the names of its parameters. Their values come from the environment when the test runs, as `ECR_PARAM_<NAME>`.

Point the replay at a system whose behaviour changed, and it fails with the step and the oracle:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts
FAIL  anna-first-item (node-test, 95 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      A failed oracle is never repaired: it is a regression or an intended change, and a person decides.
```

## Roadmap

These are targets, not promises.

| When | What |
|---|---|
| Week of 24 November 2026 | The contract in the open: schema, adapter contract, laws |
| Week of 1 December | The mobile adapter on a real device, with traces written by mobile-agent-testers. MCP server and skills, the rest of the conformance kit |
| Week of 8 December | Web adapter with Playwright, drift benchmark, version 0.1 |
| After | A real app as a case study, more adapters, a paper |

## Prior art

ECR does not claim to be first. Several tools already keep or replay what an agent did, each for its own system: [Stagehand](https://github.com/browserbase/stagehand), [Skyvern](https://github.com/Skyvern-AI/skyvern), [workflow-use](https://github.com/browser-use/workflow-use), [Midscene](https://github.com/web-infra-dev/midscene), [Arbigent](https://github.com/takahirom/arbigent), [muscle-mem](https://github.com/pig-dot-dev/muscle-mem) and [autocompile](https://github.com/mirkokiefer/autocompile).

What this project adds is a name for the pattern and a written contract for it: one that works across systems, compiles to files that run without the tool, protects what the tests check, and can be verified by a conformance kit.

## Where it comes from

ECR generalizes [mobile-agent-testers](https://github.com/pierridotite/mobile-agent-testers), where AI testers explore a mobile app in parallel and report bugs. Two of its runs never take the same path. ECR is the missing half: keep the path that found the bug, as a test that runs for free.

## Feedback

The contract is the thing to challenge right now. If you maintain a test tool or an agent framework, or if you would write an adapter, open an issue and say what would not fit your system.

## License

[Apache-2.0](LICENSE)
