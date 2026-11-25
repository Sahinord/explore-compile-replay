# What exists today

Part by part, with what is a draft and what is not started. Updated with the code.

| Part | Status |
|---|---|
| Trace schema, [`spec/schema.ts`](../spec/schema.ts) | Draft. Type-checked, with a validated example and a generated [JSON Schema](../spec/trace.schema.json). A step may carry evidence (a screenshot, where the finger landed) for tools that show a trace |
| Adapter contract, [`spec/contract.ts`](../spec/contract.ts) | Draft. Type-checked |
| Seven laws, [`spec/laws.md`](../spec/laws.md) | Draft |
| Core, [`packages/core`](../packages/core/src/index.ts) | First slice: record a trace through a driver, validate it, hash it, resolve parameters, check a source map, tell a recorded bug from a regression |
| `ecr` command, [`packages/cli`](../packages/cli/src/run.ts) | Runs from this repository: `validate`, `compile`, `replay`, `repair`, `conformance`. Not on npm yet. See [the command](command.md) |
| MCP server and skills, for an agent to explore | Not started |
| Reference adapter, [`packages/adapter-fixture`](../packages/adapter-fixture/src/adapter.ts) | Runs. A to-do list in memory, compiled to a plain `node:test` file |
| Conformance kit, [`packages/conformance`](../packages/conformance/src/index.ts) | Checks L1, L2, L3, L4 (with the network closed), L5 and L7, and part of L6 |
| Repair, [`packages/core`](../packages/core/src/repair.ts) | First slice: `ecr repair` accepts or refuses a new action for the step that diverged. It calls no model and proposes nothing itself. Tried on the reference adapter only, not yet on a device |
| Mobile adapter, [`packages/adapter-maestro`](../packages/adapter-maestro/README.md) | Draft. A mobile vocabulary and a compiler to [Maestro](https://maestro.dev) flows. On an Android emulator, against the demo app of mobile-agent-testers: two flows written by hand replay in a [run started by hand](../.github/workflows/device.yml), and of four paths explored by an agent, two stopped on a step and two, of 37 and 25 steps, replayed in full with no model. A failure names its step or its oracle. No driver. Not tried on iOS. A real app, LocalSend, is being tried now |
| Web adapter, compiling to Playwright tests | Planned |
| Drift benchmark: does a replay break, repair, or stay red when it should? | Not run. Its protocol is written first: [`paper/protocol.md`](../paper/protocol.md) |
| Paper | Being written. No measured result yet |
