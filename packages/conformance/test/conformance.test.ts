import assert from "node:assert/strict";
import { test } from "node:test";
import type { Adapter } from "../../../spec/contract.ts";
import type { Todo } from "../../adapter-fixture/src/todo.ts";
import { createFixtureAdapter, type TodoAction, type TodoOracle, type TodoTrace } from "../../adapter-fixture/src/adapter.ts";
import { bugExploration, exampleExploration, exampleValues } from "../../adapter-fixture/src/example.ts";
import { record } from "../../core/src/index.ts";
import { checkAdapter, conforms, formatReport, type LawId, type LawResult } from "../src/index.ts";

type Fixture = Adapter<Todo[], TodoAction, TodoOracle>;

async function exampleTrace(): Promise<TodoTrace> {
  return record(createFixtureAdapter(), exampleExploration);
}

function status(results: readonly LawResult[], law: LawId): string {
  return results.find((entry) => entry.law === law)!.status;
}

/** The fixture with one piece replaced by a faulty one. */
function broken(change: (adapter: Fixture) => Partial<Fixture>): Fixture {
  const adapter = createFixtureAdapter();
  return { ...adapter, ...change(adapter) };
}

test("the reference adapter obeys every law the kit can check", async () => {
  const results = await checkAdapter(createFixtureAdapter(), [{ trace: await exampleTrace(), params: exampleValues }]);
  assert.equal(conforms(results), true, formatReport(results));
  assert.deepEqual(
    results.map((entry) => `${entry.law} ${entry.status}`),
    ["L1 pass", "L2 partial", "L3 pass", "L4 partial", "L5 pass", "L6 partial", "L7 pass"],
  );
});

test("L1 fails when two compilations differ", async () => {
  let calls = 0;
  const adapter = broken((fixture) => ({
    targets: fixture.targets.map((target) => ({
      ...target,
      compile: (trace: TodoTrace) => {
        const artifact = target.compile(trace);
        calls += 1;
        return { ...artifact, content: `// build ${calls}\n${artifact.content}` };
      },
    })),
  }));
  const results = await checkAdapter(adapter, [{ trace: await exampleTrace(), params: exampleValues }], { replays: 1 });
  assert.equal(status(results, "L1"), "fail");
  assert.equal(conforms(results), false);
});

test("L2 fails when a recorded trace does not replay green", async () => {
  const drifted = createFixtureAdapter({ system: new URL("../../adapter-fixture/test/systems/behaviour-change.ts", import.meta.url).href });
  const results = await checkAdapter(drifted, [{ trace: await exampleTrace(), params: exampleValues }], { replays: 1 });
  assert.equal(status(results, "L2"), "fail");
});

test("L2 holds for a trace that records a bug, as long as the replay stops on that bug", async () => {
  const system = new URL("../../adapter-fixture/test/systems/behaviour-change.ts", import.meta.url).href;
  const { TodoApp } = (await import(system)) as typeof import("../../adapter-fixture/test/systems/behaviour-change.ts");
  const buggy = createFixtureAdapter({ system, create: () => new TodoApp() });
  const trace = await record(buggy, bugExploration);

  const same = await checkAdapter(buggy, [{ trace }], { replays: 2 });
  assert.equal(status(same, "L1"), "pass");
  assert.equal(status(same, "L2"), "partial");
  assert.equal(conforms(same), true, formatReport(same));

  // On a system without the bug, the replay is green: it is not what was recorded.
  const other = await checkAdapter(createFixtureAdapter(), [{ trace }], { replays: 1 });
  assert.equal(status(other, "L2"), "fail");
});

test("L3 fails when two steps share a range", async () => {
  const adapter = broken((fixture) => ({
    targets: fixture.targets.map((target) => ({
      ...target,
      compile: (trace: TodoTrace) => {
        const artifact = target.compile(trace);
        const first = artifact.sourceMap[0]!;
        return { ...artifact, sourceMap: artifact.sourceMap.map((range) => ({ ...range, startLine: first.startLine })) };
      },
    })),
  }));
  const results = await checkAdapter(adapter, [{ trace: await exampleTrace(), params: exampleValues }], { replays: 1 });
  assert.equal(status(results, "L3"), "fail");
});

test("L4 fails when the artifact imports a model SDK", async () => {
  const adapter = broken((fixture) => ({
    targets: fixture.targets.map((target) => ({
      ...target,
      compile: (trace: TodoTrace) => {
        const artifact = target.compile(trace);
        return { ...artifact, content: `${artifact.content}// import OpenAI from "openai";\nawait import("openai").catch(() => {});\n` };
      },
    })),
  }));
  const results = await checkAdapter(adapter, [{ trace: await exampleTrace(), params: exampleValues }], { replays: 1 });
  assert.equal(status(results, "L4"), "fail");
});

test("L5 fails when restore does not bring the state back, and is skipped when not declared", async () => {
  const trace = await exampleTrace();
  const forgetful = broken((fixture) => ({ driver: { ...fixture.driver, restore: async () => {} } }));
  assert.equal(status(await checkAdapter(forgetful, [{ trace, params: exampleValues }], { replays: 1 }), "L5"), "fail");

  const without = broken((fixture) => ({ driver: { ...fixture.driver, capabilities: { snapshot: false } } }));
  assert.equal(status(await checkAdapter(without, [{ trace, params: exampleValues }], { replays: 1 }), "L5"), "skipped");
});

test("L6 fails when a new action for one step changes the text of another", async () => {
  // A target that writes, in every step, how many "add" actions the whole trace has.
  const adapter = broken((fixture) => ({
    targets: fixture.targets.map((target) => ({
      ...target,
      compile: (trace: TodoTrace) => {
        const artifact = target.compile(trace);
        const adds = trace.steps.filter((step) => step.action.kind === "add").length;
        const lines = artifact.content.split("\n");
        for (const range of artifact.sourceMap) lines[range.startLine - 1] += ` (${adds} adds in this trace)`;
        return { ...artifact, content: lines.join("\n") };
      },
    })),
  }));
  const results = await checkAdapter(adapter, [{ trace: await exampleTrace(), params: exampleValues }], { replays: 1 });
  assert.equal(status(results, "L6"), "fail");
  assert.equal(status(results, "L3"), "pass");
});

test("L6 is skipped, not passed, when no trace has two different actions", async () => {
  const one = await record(createFixtureAdapter(), { ...exampleExploration, steps: exampleExploration.steps.slice(0, 1) });
  const results = await checkAdapter(createFixtureAdapter(), [{ trace: one, params: exampleValues }], { replays: 1 });
  assert.equal(status(results, "L6"), "skipped");
});

test("L7 fails when a secret value is written in the trace", async () => {
  const trace = await exampleTrace();
  const leaked: TodoTrace = {
    ...trace,
    steps: trace.steps.map((step) =>
      step.id === "s2" ? { ...step, action: { kind: "add", title: exampleValues.PRIVATE_NOTE } } : step,
    ),
  };
  // The leaked trace no longer replays green either: only L7 is under test here.
  const results = await checkAdapter(createFixtureAdapter(), [{ trace: leaked, params: exampleValues }], { replays: 1 });
  assert.equal(status(results, "L7"), "fail");
});

test("L7 is skipped, not passed, when no trace declares a secret", async () => {
  const trace = await exampleTrace();
  const open: TodoTrace = { ...trace, params: trace.params.map((param) => ({ ...param, secret: false })) };
  const results = await checkAdapter(createFixtureAdapter(), [{ trace: open, params: exampleValues }], { replays: 1 });
  assert.equal(status(results, "L7"), "skipped");
});
