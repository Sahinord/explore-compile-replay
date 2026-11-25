import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { Trace } from "../../../spec/schema.ts";
import { ExplorationError, outcomeOf, record } from "../../core/src/index.ts";
import { compileToNodeTest, createFixtureAdapter, type TodoTrace } from "../src/adapter.ts";
import { bugExploration, exampleExploration, exampleValues } from "../src/example.ts";
import buggy from "./systems/buggy-adapter.ts";

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
  for (const trace of [await exampleTrace(), await record(buggy, bugExploration)]) {
    const artifact = compileToNodeTest(trace);
    assert.equal(`${JSON.stringify(trace, null, 2)}\n`, readFileSync(join(examples, `${trace.id}.trace.json`), "utf8"));
    assert.equal(artifact.content, readFileSync(join(examples, artifact.path), "utf8"));
  }
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

test("bug: an oracle that fails while exploring is recorded when it is declared as a bug", async () => {
  const trace = await record(buggy, bugExploration);
  assert.equal(Trace.safeParse(trace).success, true);
  assert.deepEqual(
    trace.steps.flatMap((step) => step.checkpoints).map((oracle) => [oracle.id, oracle.observed]),
    [["one-item", undefined], ["not-done-yet", "failed"], ["two-items", undefined]],
  );
  assert.match(compileToNodeTest(trace).content, /\/\/ Known bug: .*\n\s+assert\.equal\(.*"Bread"\)\?\.done, false\);/);
});

test("bug: an oracle declared as a bug must be false, and an invariant cannot be one", async () => {
  // On the reference system the item is not ticked: there is no bug to record.
  await assert.rejects(record(createFixtureAdapter(), bugExploration), /declared as a bug, but it holds/);

  const [invariant] = bugExploration.invariants!;
  await assert.rejects(
    record(buggy, { ...bugExploration, invariants: [{ ...invariant!, observed: "failed" }] }),
    ExplorationError,
  );
  const stored = await record(buggy, bugExploration);
  const edited = { ...stored, invariants: stored.invariants.map((oracle) => ({ ...oracle, observed: "failed" })) };
  assert.equal(Trace.safeParse(edited).success, false);
});

test("bug: the replay says known bug while the bug is there, and fixed once it is gone", async () => {
  const trace = await record(buggy, bugExploration);

  const still = await buggy.targets[0]!.replay(compileToNodeTest(trace));
  assert.equal(still.verdict, "fail");
  assert.equal(outcomeOf(trace, still), "known_bug");

  const fixed = await createFixtureAdapter().targets[0]!.replay(compileToNodeTest(trace));
  assert.equal(fixed.verdict, "pass");
  assert.equal(outcomeOf(trace, fixed), "fixed");
});

test("bug: any other divergence is a failure, with or without a recorded bug", async () => {
  const trace = await record(buggy, bugExploration);
  const ms = { durationMs: 1 };
  const failed = (divergence: Parameters<typeof outcomeOf>[1]["divergences"][number]) =>
    outcomeOf(trace, { verdict: "fail", divergences: [divergence], ...ms });

  assert.equal(failed({ type: "oracle_failed", oracleId: "not-done-yet", stepId: "s1" }), "known_bug");
  // A guard that comes before the bug no longer holds.
  assert.equal(failed({ type: "oracle_failed", oracleId: "one-item", stepId: "s1" }), "fail");
  // The step itself could not run.
  assert.equal(failed({ type: "action_failed", stepId: "s1" }), "fail");

  const plain = await exampleTrace();
  assert.equal(outcomeOf(plain, { verdict: "pass", divergences: [], ...ms }), "pass");
  assert.equal(outcomeOf(plain, { verdict: "fail", divergences: [{ type: "oracle_failed", oracleId: "not-done-yet", stepId: "s1" }], ...ms }), "fail");
});
