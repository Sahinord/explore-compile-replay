# Contributing

Thanks for helping. Open an issue before you start, to say what you want to build: two people won't work on the same thing, and we can agree on the shape before you write code. Small pull requests get merged faster than big ones.

The most useful thing you can do today costs no code: read the [contract](spec/contract.ts) and the [seven laws](spec/laws.md) with your own system in mind, and [say what would not fit](https://github.com/pierridotite/explore-compile-replay/issues/new).

## Before you open a pull request

- Run `pnpm check`: types, generated schemas, examples, links, tests and the conformance report. You need Node 22.18 or later and pnpm. Nothing needs a phone, a browser or a key.
- Compiling and replaying call no model, and CI runs the conformance kit with the network closed. Keep it so.
- A trace and a compiled file never hold a secret value. A text that was typed is stored by its name.
- [`spec/`](spec/) is the specification: the trace format, the adapter contract, the laws. A change there changes what every adapter must do, so it starts with an issue that says which system it does not fit, and why.
- When you change a vocabulary or the trace format, run `pnpm schema` and commit the generated JSON Schema.
- Say how you tested. For an adapter, paste its conformance report.

## Two large pieces that are open

Both are planned and not started. Each one can be built in slices, and the first slice of each is small.

### A web adapter, compiled to Playwright tests

A new package, `packages/adapter-web`, next to [`packages/adapter-maestro`](packages/adapter-maestro/README.md), which is the model to follow: about 300 lines.

- **A vocabulary**, with zod: actions such as `goto`, `click`, `fill`, `press`, and oracles such as `visible`, `hasText`, `hasUrl`. A target is found by role and name first, then by test id, then by a CSS selector: the same order of preference as the mobile adapter, which goes from a name to an id to a point.
- **A compiler** to a plain `@playwright/test` file that runs without ECR. A text that was typed stays a name in the file and takes its value from the environment. Each step maps to one range of lines (law L3), and the same trace compiles to the same bytes (law L1).
- **A replay** that runs the file with `npx playwright test` and turns a failure into a divergence: which step, or which oracle, and its type.

A first slice is the vocabulary, the compiler and two example traces with their compiled files, checked by `pnpm check`. The replay and the conformance report come next. A driver, which lets an agent explore through ECR, can wait for the MCP server.

### An MCP server, so that your own agent explores through ECR

Today a trace is written by the tool that drives the agent. A server, `packages/mcp`, would let any agent that speaks the Model Context Protocol explore a system and leave a valid trace, with no code of its own.

- **Tools**: start an exploration (an adapter, a persona, the names of the parameters), do one action of the adapter's vocabulary, check one oracle, finish and get the trace.
- It is built on [`record`](packages/core/src/index.ts) and on the driver of an adapter. The [reference adapter](packages/adapter-fixture/src/adapter.ts) has a driver and needs no device: develop against it.
- The server calls no model. The agent on the other side does the thinking; the server only runs actions and checks, and writes what happened.

A first slice is a server over stdio with these four tools on the reference adapter, and a test that explores the to-do list through it and replays the trace it wrote.

## Smaller tasks to start with

- **More keys in the mobile vocabulary.** `pressKey` knows Enter, Backspace, Home and Back. Maestro knows more (Tab, Delete, volume keys, Lock). They are one enum and one test in [`packages/adapter-maestro/src/adapter.ts`](packages/adapter-maestro/src/adapter.ts).
- **A parameter in a selector is read as a regular expression.** Maestro matches a text as a regular expression. A literal text is escaped when it is compiled, but the value of a parameter is not, so a typed text with a `(` or a `+` in it may not be found again. See `matchedText` in the same file.
- **The second half of law L6.** The kit checks that a patch stays inside its step. It does not check yet that a change of behaviour comes back as a failed oracle and is never repaired. The report says so itself: see [`packages/conformance`](packages/conformance/src/index.ts).
- **The mobile adapter on iOS.** It was only run on an Android emulator. Replay the [device examples](packages/adapter-maestro/device/) on a simulator and report what differs.
- **Validate a trace outside TypeScript.** The format is published as a [JSON Schema](spec/trace.schema.json). A short script in another language that validates the example traces with it would show where the schema says less than the TypeScript does.
- **An adapter for an HTTP API.** A third kind of system, after an app in memory and a mobile app: a handful of actions (a request) and oracles (a status, a field of the answer), compiled to a file a standard tool runs, such as a [Hurl](https://hurl.dev) file. It is a good way to challenge the contract.

## How a change to the specification is decided

In the open, in an issue. The format carries its version (`ecr.trace/0`), and while it is a draft it can change without notice: what changed is written in the [changelog](CHANGELOG.md). An adapter that passes the conformance kit conforms, whoever wrote it.
