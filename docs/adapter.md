# Write an adapter

English · [简体中文](../i18n/zh-CN/docs/adapter.md) · [日本語](../i18n/ja/docs/adapter.md) · [Español](../i18n/es/docs/adapter.md) · [Português](../i18n/pt-BR/docs/adapter.md) · [Tiếng Việt](../i18n/vi/docs/adapter.md) · [Türkçe](../i18n/tr/docs/adapter.md)

An adapter connects Explore-Compile-Replay to one kind of system. This page has the shape of an adapter and the choices behind it. The exact types are in [`spec/contract.ts`](../spec/contract.ts), the data shapes in [`spec/schema.ts`](../spec/schema.ts) and the seven laws in [`spec/laws.md`](../spec/laws.md).

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

The draft types are in [`spec/contract.ts`](../spec/contract.ts) and the data shapes in [`spec/schema.ts`](../spec/schema.ts). An example trace is in [`spec/examples/`](../spec/examples/).

## Design choices

- **The artifact is a standard file.** If you stop using ECR, your tests still run.
- **No built-in LLM loop.** Exploring is done by the agent you already use, through an MCP server and skills. ECR records, validates and compiles.
- **The core will never import an LLM SDK.** A replay cannot call a model by accident.
- **Oracles are data.** Every target can emit them, and a repair can prove it removed none.
- **A bug is a test too.** When the agent finds something wrong, the check that should hold is recorded as failed. It compiles to a test that is red until the bug is fixed.
