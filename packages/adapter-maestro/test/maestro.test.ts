import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { checkSourceMap, parseTrace } from "../../core/src/index.ts";
import { compileToMaestro, createMaestroAdapter, type MobileAction, type MobileTrace } from "../src/adapter.ts";

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
