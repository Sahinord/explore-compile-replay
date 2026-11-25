import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkSourceMap, outcomeOf, parseTrace } from "../../core/src/index.ts";
import { compileToMaestro, createMaestroAdapter, failedCommand, flowCommands, maestroTarget, type MobileAction, type MobileTrace } from "../src/adapter.ts";

const examples = join(import.meta.dirname, "..", "examples");
const adapter = createMaestroAdapter();

function example(): MobileTrace {
  return parseTrace(adapter, JSON.parse(readFileSync(join(examples, "anna-first-item-mobile.trace.json"), "utf8")));
}

/** The example with its steps after launchApp replaced. */
function withSteps(...actions: MobileAction[]): MobileTrace {
  const trace = example();
  return {
    ...trace,
    invariants: [],
    steps: [trace.steps[0]!, ...actions.map((action, index) => ({ id: `t${index + 1}`, action, checkpoints: [] }))],
  };
}

function commands(trace: MobileTrace): string {
  const content = compileToMaestro(trace).content;
  return content.slice(content.indexOf("# Step t1"));
}

test("the flow in examples/ is what the compiler gives today", () => {
  const artifact = compileToMaestro(example());
  assert.equal(artifact.path, "anna-first-item-mobile.flow.yaml");
  assert.equal(artifact.content, readFileSync(join(examples, artifact.path), "utf8"));
});

test("L1 and L3: the same trace gives the same bytes, and each step has its own range", () => {
  const trace = example();
  const artifact = compileToMaestro(trace);
  assert.deepEqual(compileToMaestro(trace), artifact);
  assert.deepEqual(checkSourceMap(artifact, trace.steps.map((step) => step.id)), []);
});

test("L7: the flow names its parameters and never holds a value", () => {
  const content = compileToMaestro(example()).content;
  assert.match(content, /- inputText: "\$\{ACCOUNT_PASSWORD\}"/);
  assert.match(content, /maestro test -e ITEM_TITLE=<value> -e ACCOUNT_PASSWORD=<value>/);
});

test("the header names the app of the first step", () => {
  const content = compileToMaestro(example()).content;
  assert.match(content, /^appId: com\.example\.todo$/m);
  assert.match(content, /^---$/m);
});

test("a literal text is escaped, because Maestro matches text as a regular expression", () => {
  const flow = commands(withSteps({ kind: "tapOn", target: { text: "Total: $4.50 (2 items)?" } }));
  assert.match(flow, /text: "Total: \\\\\$4\\\\\.50 \\\\\(2 items\\\\\)\\\\\?"/);
});

test("typed text is not escaped", () => {
  assert.match(commands(withSteps({ kind: "inputText", text: "a.b (c)" })), /- inputText: "a\.b \(c\)"/);
});

test("every action of the vocabulary compiles", () => {
  const flow = commands(
    withSteps(
      { kind: "tapOn", target: { id: "save_button", index: 1 } },
      { kind: "tapOn", target: { point: "50%,90%" } },
      { kind: "longPressOn", target: { text: "Buy bread" } },
      { kind: "eraseText" },
      { kind: "eraseText", characters: 5 },
      { kind: "pressKey", key: "Enter" },
      { kind: "pressKey", key: "Back" },
      { kind: "swipe", direction: "LEFT" },
      { kind: "scrollUntilVisible", target: { text: "Delete account" }, direction: "DOWN" },
      { kind: "hideKeyboard" },
    ),
  );
  assert.equal(
    flow,
    `# Step t1
- tapOn:
    id: "save_button"
    index: 1
# Step t2
- tapOn:
    point: "50%,90%"
# Step t3
- longPressOn:
    text: "Buy bread"
# Step t4
- eraseText
# Step t5
- eraseText: 5
# Step t6
- pressKey: Enter
# Step t7
- back
# Step t8
- swipe:
    direction: LEFT
# Step t9
- scrollUntilVisible:
    element:
      text: "Delete account"
    direction: DOWN
# Step t10
- hideKeyboard
`,
  );
});

test("a trace that cannot become a valid flow is refused", () => {
  const trace = example();
  assert.throws(() => compileToMaestro({ ...trace, steps: trace.steps.slice(1) }), /launchApp/);
  assert.throws(() => compileToMaestro({ ...trace, params: [] }), /does not declare/);
  assert.throws(() => compileToMaestro(withSteps({ kind: "inputText", text: "costs ${price}" })), /cannot contain/);
});

test("the vocabulary refuses a check on a point, and an unknown action", () => {
  assert.equal(adapter.oracles.safeParse({ kind: "visible", target: { point: "50%,50%" } }).success, false);
  assert.equal(adapter.actions.safeParse({ kind: "shake" }).success, false);
  assert.equal(adapter.actions.safeParse({ kind: "inputText", text: { param: "not a name" } }).success, false);
});

test("evidence is carried by the trace and changes no command of the flow", () => {
  const trace = example();
  assert.deepEqual(trace.steps[1]!.evidence, { screen: "01", point: [540, 460], size: [1080, 2400], bounds: [40, 400, 1040, 520] });
  const without: MobileTrace = { ...trace, steps: trace.steps.map(({ evidence: _evidence, ...step }) => step) };
  const commandsOf = (content: string): string => content.slice(content.indexOf("appId:"));
  assert.equal(commandsOf(compileToMaestro(without).content), commandsOf(compileToMaestro(trace).content));
});

test("an oracle recorded as a bug is asserted like the others, under a comment", () => {
  const trace = withSteps({ kind: "tapOn", target: { text: "Save" } });
  const last = trace.steps.at(-1)!;
  const flow = commands({
    ...trace,
    steps: [
      ...trace.steps.slice(0, -1),
      { ...last, checkpoints: [{ id: "saved", check: { kind: "visible", target: { text: "Saved" } }, observed: "failed" }] },
    ],
  });
  assert.match(flow, /# Oracle saved\n# Known bug: [^\n]+\n- assertVisible:\n {4}text: "Saved"/);
});

const device = join(import.meta.dirname, "..", "device");

function deviceTrace(name: string): MobileTrace {
  return parseTrace(adapter, JSON.parse(readFileSync(join(device, `${name}.trace.json`), "utf8")));
}

/**
 * A stand-in for the `maestro` command: it writes the record of a run in
 * which the command at `failAt` failed, in the shape Maestro gives to
 * `--debug-output`, and exits like Maestro does.
 */
function fakeMaestro(dir: string, total: number, failAt: number | undefined, message: string): string {
  const entries = [
    { command: { applyConfigurationCommand: {} }, metadata: { status: "COMPLETED" } },
    { command: { defineVariablesCommand: {} }, metadata: { status: "COMPLETED" } },
    ...Array.from({ length: failAt === undefined ? total : failAt + 1 }, (_, index) => ({
      command: { tapOnElement: {} },
      metadata: index === failAt ? { status: "FAILED", error: { message } } : { status: "COMPLETED" },
    })),
  ];
  const record = join(dir, "record.json");
  writeFileSync(record, JSON.stringify(entries));
  const script = join(dir, "maestro");
  writeFileSync(
    script,
    [
      "#!/usr/bin/env bash",
      'while [ $# -gt 0 ]; do [ "$1" = "--debug-output" ] && out="$2"; shift; done',
      'mkdir -p "$out" && cp "$(dirname "$0")/record.json" "$out/commands-(replay.flow).json"',
      `exit ${failAt === undefined ? 0 : 1}`,
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  return script;
}

test("the flows in device/ are what the compiler gives today", () => {
  for (const name of ["tiny-todo-first-task", "tiny-todo-one-tasks"]) {
    const artifact = compileToMaestro(deviceTrace(name));
    assert.equal(artifact.content, readFileSync(join(device, artifact.path), "utf8"));
  }
});

test("flowCommands names the step and the oracle of each command, in order", () => {
  const trace = deviceTrace("tiny-todo-one-tasks");
  const commands = flowCommands(compileToMaestro(trace));
  // One command per step, and after each step its checkpoints then the invariant.
  const expected = trace.steps.flatMap((step) => [
    { stepId: step.id },
    ...[...step.checkpoints, ...trace.invariants].map((oracle) => ({ stepId: step.id, oracleId: oracle.id })),
  ]);
  assert.deepEqual(commands, expected);
});

test("replay: a failed assertion comes back as the oracle it checks, and a recorded bug is told from a regression", async () => {
  const trace = deviceTrace("tiny-todo-one-tasks");
  const artifact = compileToMaestro(trace);
  const commands = flowCommands(artifact);
  const params = { NAME: "Anna", EMAIL: "anna@example.com", PASSWORD: "long-enough-1" };
  const dir = mkdtempSync(join(tmpdir(), "ecr-fake-maestro-"));
  try {
    const run = (failAt: number | undefined, message = "Assertion is false") =>
      maestroTarget({ command: fakeMaestro(dir, commands.length, failAt, message) }).replay(artifact, { params });

    // The oracle recorded as a bug fails: the bug is still there.
    const bugAt = commands.findIndex((command) => command.oracleId === "counter-singular");
    const bug = await run(bugAt);
    assert.deepEqual(bug.divergences, [{ type: "oracle_failed", oracleId: "counter-singular", stepId: "search", message: "Assertion is false" }]);
    assert.equal(outcomeOf(trace, bug), "known_bug");

    // A guard fails earlier: a regression.
    const guard = await run(commands.findIndex((command) => command.oracleId === "four-tasks"));
    assert.equal(outcomeOf(trace, guard), "fail");

    // A step does not find its target. The value of a parameter never reaches the report.
    const stepAt = commands.findIndex((command) => command.stepId === "continue" && command.oracleId === undefined);
    const step = await run(stepAt, 'Element not found: Text matching regex: Continue (typed "long-enough-1")');
    assert.deepEqual(
      step.divergences.map((divergence) => [divergence.type, divergence.stepId]),
      [["target_not_found", "continue"]],
    );
    assert.equal(JSON.stringify(step).includes("long-enough-1"), false);
    assert.match(step.divergences[0]!.message!, /\$\{PASSWORD\}/);

    // Everything holds: the bug is gone.
    assert.equal(outcomeOf(trace, await run(undefined)), "fixed");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("failedCommand gives nothing, rather than a guess, when the record has another shape", () => {
  const commands = flowCommands(compileToMaestro(deviceTrace("tiny-todo-first-task")));
  assert.equal(failedCommand({ not: "a list" }, commands), undefined);
  assert.equal(failedCommand([{ command: { tapOnElement: {} }, metadata: { status: "COMPLETED" } }], commands), undefined);
  const tooMany = Array.from({ length: commands.length + 1 }, () => ({ command: { tapOnElement: {} }, metadata: { status: "FAILED" } }));
  assert.equal(failedCommand(tooMany, commands), undefined);
});
