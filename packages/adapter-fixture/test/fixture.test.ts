import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Trace } from "../../../spec/schema.ts";
import { ExplorationError, record } from "../../core/src/index.ts";
import { compileToNodeTest, createFixtureAdapter, type TodoTrace } from "../src/adapter.ts";
import { exampleExploration, exampleValues } from "../src/example.ts";

const examples = join(import.meta.dirname, "..", "examples");
const system = (name: string): string => new URL(`./systems/${name}.ts`, import.meta.url).href;

async function exampleTrace(): Promise<TodoTrace> {
  return record(createFixtureAdapter(), exampleExploration);
}

test("explore: recording gives a valid trace that holds names, not values", async () => {
  const trace = await exampleTrace();
  assert.equal(Trace.safeParse(trace).success, true);
  assert.equal(trace.steps.length, 4);
  const stored = JSON.stringify(trace);
  for (const value of Object.values(exampleValues)) assert.equal(stored.includes(value), false);
});

test("explore: an oracle that fails while exploring is never recorded", async () => {
  const exploration = {
    ...exampleExploration,
    steps: [
      {
        id: "s1",
        action: { kind: "add", title: "Bread" } as const,
        checkpoints: [{ id: "wrong", check: { kind: "count", equals: 2 } as const }],
      },
    ],
  };
  await assert.rejects(record(createFixtureAdapter(), exploration), ExplorationError);
});

test("explore: an action outside the vocabulary is refused before the system is touched", async () => {
  const exploration = {
    ...exampleExploration,
    steps: [{ id: "s1", action: { kind: "shake", title: "Bread" } as never }],
  };
  await assert.rejects(record(createFixtureAdapter(), exploration));
});

test("compile: the files in examples/ are what the compiler gives today", async () => {
  const trace = await exampleTrace();
  const artifact = compileToNodeTest(trace);
  assert.equal(`${JSON.stringify(trace, null, 2)}\n`, readFileSync(join(examples, `${trace.id}.trace.json`), "utf8"));
  assert.equal(artifact.content, readFileSync(join(examples, artifact.path), "utf8"));
});

test("compile: a parameter that the trace does not declare is refused", async () => {
  const trace = await exampleTrace();
  assert.throws(() => compileToNodeTest({ ...trace, params: [] }), /ITEM_TITLE/);
});

test("replay: the compiled test passes on the system it was recorded on", async () => {
  const adapter = createFixtureAdapter();
  const target = adapter.targets[0]!;
  const result = await target.replay(target.compile(await exampleTrace()), { params: exampleValues });
  assert.deepEqual({ verdict: result.verdict, divergences: result.divergences }, { verdict: "pass", divergences: [] });
});

test("replay: a behaviour change is reported as a failed oracle", async () => {
  const target = createFixtureAdapter({ system: system("behaviour-change") }).targets[0]!;
  const result = await target.replay(target.compile(await exampleTrace()), { params: exampleValues });
  assert.equal(result.verdict, "fail");
  assert.equal(result.divergences.length, 1);
  const divergence = result.divergences[0]!;
  assert.equal(divergence.type, "oracle_failed");
  assert.deepEqual(
    divergence.type === "oracle_failed" && [divergence.oracleId, divergence.stepId],
    ["not-done-yet", "s1"],
  );
});

test("replay: a target that is no longer found is reported as such, on its step", async () => {
  const target = createFixtureAdapter({ system: system("target-moved") }).targets[0]!;
  const result = await target.replay(target.compile(await exampleTrace()), { params: exampleValues });
  assert.equal(result.verdict, "fail");
  assert.deepEqual(
    result.divergences.map((divergence) => [divergence.type, divergence.stepId]),
    [["target_not_found", "s3"]],
  );
});

test("replay: a missing parameter value is an error, not a divergence", async () => {
  const target = createFixtureAdapter().targets[0]!;
  await assert.rejects(target.replay(target.compile(await exampleTrace()), { params: { ITEM_TITLE: "Bread" } }), /PRIVATE_NOTE/);
});
