# The `ecr` command

Everything here runs from a clone of this repository, with Node 22.18 or later and pnpm. Compiling and replaying call no model.

## Check your clone

```sh
pnpm install
pnpm check        # types, schema, examples, tests, conformance
pnpm conformance  # the report alone
```

The report for the reference adapter:

```text
L1  Determinism   pass     same bytes on two compilations, same verdict on 3 replays (1 trace, 1 target)
L2  Fidelity      pass     recorded traces replay as observed, and an instrumented system receives their actions and oracles in order, and nothing else (1 trace, 1 target)
L3  Traceability  pass     every step has one range, inside the file, with no overlap (1 trace, 1 target)
L4  No model      partial  no artifact imports a known model SDK; this run did not have the network closed
L5  State         pass     state identical after restore (1 trace)
L6  Safe repair   partial  a new action for one step leaves the text of the other steps (4 patches); that a behaviour change comes back as a failed oracle is not checked yet
L7  No secret     pass     1 secret value searched in traces and artifacts, none found
```

"partial" and "skipped" are not passes. They mark what the kit cannot prove yet, or could not prove in this run. L4 passes when the network is closed around the command: CI runs `pnpm conformance --network-closed` in a network namespace that only has the loopback.

To see the three steps on one example, read these two files side by side:

- the trace an exploration recorded: [`anna-first-item.trace.json`](../packages/adapter-fixture/examples/anna-first-item.trace.json)
- the test it compiles to: [`anna-first-item.test.mjs`](../packages/adapter-fixture/examples/anna-first-item.test.mjs). It imports nothing from this project, and it holds the names of its parameters, never their values.

The same for a mobile app: [a trace](../packages/adapter-maestro/examples/anna-first-item-mobile.trace.json) and [the Maestro flow](../packages/adapter-maestro/examples/anna-first-item-mobile.flow.yaml) it compiles to.

On a device, with no model, against the demo app of mobile-agent-testers and its planted bugs:

```text
pass  tiny-todo-first-task (maestro, 61927 ms)
bug   tiny-todo-one-tasks (maestro, 65996 ms)
      oracle_failed  step search  oracle counter-singular: Assertion is false: "1 task" is visible
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

The second trace holds a bug as a check: the counter says "1 tasks". Both traces are written by hand for now, in [`packages/adapter-maestro/device`](../packages/adapter-maestro/device).

The tests replay that file against two changed versions of the system. A new behaviour comes back as a failed oracle. A target that moved comes back as `target_not_found` on its step.

## Validate, compile, replay

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

## Repair, with bounds

Point the replay at a system where an item is no longer found by its title, and it breaks on a step, not on a check:

```text
$ pnpm ecr replay $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts
FAIL  anna-first-item (node-test, 92 ms)
      target_not_found  step s3: No item titled "Buy bread"
```

An agent, or you, looks at the system and proposes another action for that step. `ecr repair` decides. It replays first, to know which step diverged. It refuses a patch for any other step. It compiles the patched trace and refuses it if the text of another step changed. Then it replays, and accepts only if every oracle gives what the trace recorded.

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/moved-adapter.ts --step s3 --action '{"kind":"toggleAt","index":0}'
repaired  anna-first-item  step s3 (node-test)
      was: target_not_found  step s3: No item titled "Buy bread"
```

A patch holds one step and one action. It cannot remove or weaken a check, because it has no way to name one. Ticking the wrong item (`"index": 1`) gets past the step, breaks the oracle `done`, and is refused. And when the replay breaks on a check, nothing is accepted at all:

```text
$ pnpm ecr repair $TRACE --adapter packages/adapter-fixture/test/systems/drifted-adapter.ts --step s1 --action '{"kind":"add","title":"x"}'
REFUSED  anna-first-item  step s1 (oracle_failed)
      Oracle not-done-yet failed. A failed oracle is never repaired: it is a regression or an intended change, and a person decides
```

## A bug is a test too

An agent that explores finds bugs. A report describes them. A trace can hold them as checks.

An oracle says what should be true. When it was false during the exploration, it is recorded with `"observed": "failed"`:

```json
{ "id": "not-done-yet", "check": { "kind": "done", "title": "Bread", "equals": false }, "observed": "failed" }
```

The compiled file checks it like any other oracle, so the test is red until the bug is fixed. It is a reproduction that anyone can run: [the trace](../packages/adapter-fixture/examples/anna-new-item-ticked.trace.json), [the test](../packages/adapter-fixture/examples/anna-new-item-ticked.test.mjs).

`ecr replay` knows what the trace recorded, and gives one of four results. Only `FAIL` fails the command.

| Result | Meaning |
|---|---|
| `pass` | Every oracle holds. The trace records no bug |
| `bug` | The replay stops on the bug the trace records, and on nothing else. The bug is still there |
| `fixed` | The oracle that was recorded as a bug holds now. Remove `"observed": "failed"` and it becomes a guard |
| `FAIL` | Anything else: a step diverged, or an oracle that held no longer holds |

```text
$ pnpm ecr replay packages/adapter-fixture/examples/anna-new-item-ticked.trace.json --adapter packages/adapter-fixture/test/systems/buggy-adapter.ts
bug   anna-new-item-ticked (node-test, 90 ms)
      oracle_failed  step s1  oracle not-done-yet: Expected values to be strictly equal: true !== false
      This oracle was recorded as a bug, and the bug is still there. The steps after it did not run.
```

Two limits. A replay stops on the first bug, so what comes after it in the trace is not checked until the bug is fixed. And only a checkpoint of a step can be a bug, never an invariant.
