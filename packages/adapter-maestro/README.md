# Mobile adapter: traces to Maestro flows

Status: draft. The vocabulary and the compiler exist. The flows are checked for syntax in CI, **not yet run on a device**.

## What it does

It turns a trace of what a tester did in a mobile app into a [Maestro](https://maestro.dev) flow: a plain YAML file that `maestro test` runs on an Android emulator or an iOS Simulator, with no model.

```sh
pnpm ecr validate examples/anna-first-item-mobile.trace.json --adapter src/index.ts
pnpm ecr compile  examples/anna-first-item-mobile.trace.json --adapter src/index.ts
maestro test -e ITEM_TITLE="Buy bread" -e ACCOUNT_PASSWORD=... examples/anna-first-item-mobile.flow.yaml
```

Read the two files side by side: [the trace](examples/anna-first-item-mobile.trace.json) and [the flow](examples/anna-first-item-mobile.flow.yaml).

## The vocabulary

Actions: `launchApp`, `tapOn`, `longPressOn`, `inputText`, `eraseText`, `pressKey`, `swipe`, `scrollUntilVisible`, `hideKeyboard`.
Oracles: `visible`, `notVisible`.

A step finds its target by accessibility id, by visible text, or as a last resort by a point in percent of the screen. A check cannot be made on a point. The first step must be `launchApp`: it names the app.

The types are in [`src/adapter.ts`](src/adapter.ts).

## How a trace is written

This adapter has no driver yet, so `ecr` cannot explore a phone by itself. The trace format is the meeting point: any tool that drives a phone can write one, in any language, against [`spec/trace.schema.json`](../../spec/trace.schema.json).

The intended first writer is [mobile-agent-testers](https://github.com/pierridotite/mobile-agent-testers). Its testers already see each screen as a list of named elements and tap one of them. Recording the name of the element with each tap, instead of its coordinates, is what makes a path replayable.

## Known limits

- Maestro matches text as a regular expression. Literal texts are escaped. The value of a parameter is not: a value with `(` or `.` in it is read as a pattern.
- A literal text cannot contain `${`.
- Values are passed as `maestro test -e NAME=value`, so they are visible in the process list while the flow runs.
- `replay` only tells a pass from a failure. Typed divergences (which step, which oracle) are not written yet for Maestro.
- A tap on a point is replayed as is. It breaks on another screen size.
