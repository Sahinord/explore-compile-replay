import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompiledArtifact } from "../../../spec/schema.ts";
import { RepairRefused, checkPatchLocality, record, repair, type RefusalReason } from "../../core/src/index.ts";
import { createFixtureAdapter, type TodoAction, type TodoTrace } from "../src/adapter.ts";
import { bugExploration, exampleExploration, exampleValues } from "../src/example.ts";
import buggy from "./systems/buggy-adapter.ts";

const system = (name: string): string => new URL(`./systems/${name}.ts`, import.meta.url).href;
const params = { params: exampleValues };

async function exampleTrace(): Promise<TodoTrace> {
  return record(createFixtureAdapter(), exampleExploration);
}

/** The reason a repair is refused for, or "accepted". */
async function refusal(run: Promise<unknown>): Promise<RefusalReason | "accepted"> {
  try {
    await run;
    return "accepted";
  } catch (error) {
    if (!(error instanceof RepairRefused)) throw error;
    return error.reason;
  }
}

test("repair: a step that no longer finds its target takes a new action, and nothing else changes", async () => {
  // In this version of the system, an item is no longer found by its title.
  const adapter = createFixtureAdapter({ system: system("target-moved") });
  const target = adapter.targets[0]!;
  const trace = await exampleTrace();

  const result = await repair(adapter, target, trace, { stepId: "s3", action: { kind: "toggleAt", index: 0 } }, params);

  assert.deepEqual([result.repaired.type, result.repaired.stepId], ["target_not_found", "s3"]);
  assert.equal(result.after.verdict, "pass");
  assert.deepEqual(result.trace.steps[2]!.action, { kind: "toggleAt", index: 0 });
  // Every oracle, every other step and every parameter is the same object as before.
  assert.equal(result.trace.invariants, trace.invariants);
  assert.equal(result.trace.params, trace.params);
  result.trace.steps.forEach((step, index) => {
    assert.equal(step.checkpoints, trace.steps[index]!.checkpoints);
    if (step.id !== "s3") assert.equal(step, trace.steps[index]);
  });
  assert.deepEqual(checkPatchLocality(target.compile(trace), result.artifact, "s3"), []);
});

test("repair: a failed oracle is never repaired", async () => {
  const adapter = createFixtureAdapter({ system: system("behaviour-change") });
  const proposal = { stepId: "s1", action: { kind: "add", title: "Anything" } as TodoAction };
  assert.equal(await refusal(repair(adapter, adapter.targets[0]!, await exampleTrace(), proposal, params)), "oracle_failed");
});

test("repair: a patch for another step than the one that diverged is refused", async () => {
  const adapter = createFixtureAdapter({ system: system("target-moved") });
  const proposal = { stepId: "s4", action: { kind: "toggleAt", index: 0 } as TodoAction };
  assert.equal(await refusal(repair(adapter, adapter.targets[0]!, await exampleTrace(), proposal, params)), "wrong_step");
});

test("repair: a patch that gets past the step but breaks an oracle is refused", async () => {
  const adapter = createFixtureAdapter({ system: system("target-moved") });
  const target = adapter.targets[0]!;
  const trace = await exampleTrace();
  // Removing the item does not throw, but the item is then neither ticked nor kept.
  const wrong = repair(adapter, target, trace, { stepId: "s3", action: { kind: "remove", title: { param: "ITEM_TITLE" } } }, params);
  await assert.rejects(wrong, (error: RepairRefused) => {
    assert.equal(error.reason, "still_diverges");
    assert.deepEqual(error.divergences.map((divergence) => divergence.type), ["oracle_failed"]);
    return true;
  });
  // Ticking the wrong item is refused the same way.
  assert.equal(await refusal(repair(adapter, target, trace, { stepId: "s3", action: { kind: "toggleAt", index: 1 } }, params)), "still_diverges");
});

test("repair: an action outside the vocabulary, or with an undeclared parameter, is refused", async () => {
  const adapter = createFixtureAdapter({ system: system("target-moved") });
  const target = adapter.targets[0]!;
  const trace = await exampleTrace();
  assert.equal(await refusal(repair(adapter, target, trace, { stepId: "s3", action: { kind: "shake" } as never }, params)), "invalid_action");
  const undeclared = { stepId: "s3", action: { kind: "toggle", title: { param: "NOT_DECLARED" } } as TodoAction };
  assert.equal(await refusal(repair(adapter, target, trace, undeclared, params)), "invalid_action");
});

test("repair: there is nothing to repair when the replay gives what the trace recorded", async () => {
  const adapter = createFixtureAdapter();
  const proposal = { stepId: "s3", action: { kind: "toggleAt", index: 0 } as TodoAction };
  assert.equal(await refusal(repair(adapter, adapter.targets[0]!, await exampleTrace(), proposal, params)), "nothing_to_repair");

  // A replay that stops on the bug the trace records is what was recorded too.
  const bug = await record(buggy, bugExploration);
  const onBug = { stepId: "s1", action: { kind: "add", title: "Bread" } as TodoAction };
  assert.equal(await refusal(repair(buggy, buggy.targets[0]!, bug, onBug)), "nothing_to_repair");
});

test("checkPatchLocality: a patch may change its own step and the header, never another step", () => {
  const artifact = (content: string, sourceMap: CompiledArtifact["sourceMap"]): CompiledArtifact => ({
    target: "t",
    path: "t.txt",
    content,
    traceHash: "h",
    sourceMap,
  });
  const before = artifact("header 1\na1\nb1\nb2", [
    { stepId: "a", startLine: 2, endLine: 2 },
    { stepId: "b", startLine: 3, endLine: 4 },
  ]);
  // Step a grows by one line and the header changes: step b moved, its text did not change.
  const local = artifact("header 2\na1\na2\nb1\nb2", [
    { stepId: "a", startLine: 2, endLine: 3 },
    { stepId: "b", startLine: 4, endLine: 5 },
  ]);
  assert.deepEqual(checkPatchLocality(before, local, "a"), []);
  assert.match(checkPatchLocality(before, local, "b").join(), /changed the text of step a/);

  const dropped = artifact("header 1\na1", [{ stepId: "a", startLine: 2, endLine: 2 }]);
  assert.match(checkPatchLocality(before, dropped, "a").join(), /same steps/);
});
