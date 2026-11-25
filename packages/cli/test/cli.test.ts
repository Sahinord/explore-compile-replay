import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { exampleValues } from "../../adapter-fixture/src/example.ts";
import { run, type ExitCode } from "../src/run.ts";

const root = resolve(import.meta.dirname, "..", "..", "..");
const TRACE = "packages/adapter-fixture/examples/anna-first-item.trace.json";
const ADAPTER = "packages/adapter-fixture/src/index.ts";
const DRIFTED = "packages/adapter-fixture/test/systems/drifted-adapter.ts";
const MOVED = "packages/adapter-fixture/test/systems/moved-adapter.ts";
const BUG_TRACE = "packages/adapter-fixture/examples/anna-new-item-ticked.trace.json";
const BUGGY = "packages/adapter-fixture/test/systems/buggy-adapter.ts";
const OTHER_VOCABULARY = "spec/examples/add-first-item.trace.json";
const VALUES = { ECR_PARAM_ITEM_TITLE: exampleValues.ITEM_TITLE, ECR_PARAM_PRIVATE_NOTE: exampleValues.PRIVATE_NOTE };

async function ecr(args: string[], env: Record<string, string> = {}): Promise<{ code: ExitCode; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, { out: (line) => out.push(line), err: (line) => err.push(line), env, cwd: root });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "ecr-cli-"));
}

test("no command prints the usage and fails", async () => {
  const result = await ecr([]);
  assert.equal(result.code, 2);
  assert.match(result.out, /ecr compile/);
  assert.equal((await ecr(["--help"])).code, 0);
});

test("an unknown command, a missing adapter or an unknown target cannot run", async () => {
  assert.equal((await ecr(["frobnicate", TRACE])).code, 2);
  assert.match((await ecr(["compile", TRACE])).err, /--adapter/);
  assert.match((await ecr(["compile", TRACE, "--adapter", ADAPTER, "--target", "nope"])).err, /node-test/);
  assert.equal((await ecr(["compile", TRACE, "--bogus"])).code, 2);
  assert.match((await ecr(["validate", "no-such-file.json"])).err, /No trace/);
});

test("validate checks the schema alone, or the vocabularies of an adapter too", async () => {
  assert.equal((await ecr(["validate", TRACE, OTHER_VOCABULARY])).code, 0);
  assert.equal((await ecr(["validate", TRACE, "--adapter", ADAPTER])).code, 0);

  const other = await ecr(["validate", OTHER_VOCABULARY, "--adapter", ADAPTER]);
  assert.equal(other.code, 1);
  assert.match(other.err, /steps\.0\.action/);

  const dir = scratch();
  try {
    const broken = join(dir, "broken.trace.json");
    writeFileSync(broken, JSON.stringify({ ...JSON.parse(readFileSync(join(root, TRACE), "utf8")), steps: [] }));
    const result = await ecr(["validate", broken]);
    assert.equal(result.code, 1);
    assert.match(result.err, /steps/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compile writes the file, and --check tells a current file from a stale or missing one", async () => {
  assert.equal((await ecr(["compile", TRACE, "--adapter", ADAPTER, "--check"])).code, 0);

  const dir = scratch();
  try {
    const missing = await ecr(["compile", TRACE, "--adapter", ADAPTER, "--out", dir, "--check"]);
    assert.equal(missing.code, 1);
    assert.match(missing.err, /MISSING/);

    assert.equal((await ecr(["compile", TRACE, "--adapter", ADAPTER, "--out", dir])).code, 0);
    const file = join(dir, "anna-first-item.test.mjs");
    assert.equal(readFileSync(file, "utf8"), readFileSync(join(root, "packages/adapter-fixture/examples/anna-first-item.test.mjs"), "utf8"));
    assert.equal((await ecr(["compile", TRACE, "--adapter", ADAPTER, "--out", dir, "--check"])).code, 0);

    writeFileSync(file, `${readFileSync(file, "utf8")}// edited by hand\n`);
    const stale = await ecr(["compile", TRACE, "--adapter", ADAPTER, "--out", dir, "--check"]);
    assert.equal(stale.code, 1);
    assert.match(stale.err, /STALE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compile writes next to the trace by default", async () => {
  const dir = scratch();
  try {
    copyFileSync(join(root, TRACE), join(dir, "copy.trace.json"));
    assert.equal((await ecr(["compile", join(dir, "copy.trace.json"), "--adapter", ADAPTER])).code, 0);
    assert.match(readFileSync(join(dir, "anna-first-item.test.mjs"), "utf8"), /Trace: anna-first-item/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replay passes on the reference system and needs the parameter values", async () => {
  const without = await ecr(["replay", TRACE, "--adapter", ADAPTER]);
  assert.equal(without.code, 2);
  assert.match(without.err, /ECR_PARAM_PRIVATE_NOTE/);

  const result = await ecr(["replay", TRACE, "--adapter", ADAPTER], VALUES);
  assert.equal(result.code, 0);
  assert.match(result.out, /^pass  anna-first-item/);
});

test("replay fails on a changed behaviour and names the step and the oracle, never a value", async () => {
  const result = await ecr(["replay", TRACE, "--adapter", DRIFTED], VALUES);
  assert.equal(result.code, 1);
  assert.match(result.err, /oracle_failed  step s1  oracle not-done-yet/);
  assert.match(result.err, /a person decides/);
  assert.equal(result.err.includes(exampleValues.PRIVATE_NOTE), false);
});

test("replay tells a bug the trace records from a regression, and says when the bug is gone", async () => {
  const still = await ecr(["replay", BUG_TRACE, "--adapter", BUGGY]);
  assert.equal(still.code, 0);
  assert.match(still.out, /^bug   anna-new-item-ticked/);
  assert.match(still.out, /oracle_failed  step s1  oracle not-done-yet/);
  assert.equal(still.err, "");

  const fixed = await ecr(["replay", BUG_TRACE, "--adapter", ADAPTER]);
  assert.equal(fixed.code, 0);
  assert.match(fixed.out, /^fixed anna-new-item-ticked/);
  assert.match(fixed.out, /not-done-yet/);
});

test("replay --times replays each trace several times, and --report keeps every replay with no message and no value", async () => {
  const dir = scratch();
  try {
    const report = join(dir, "replays.json");
    const result = await ecr(["replay", TRACE, "--adapter", ADAPTER, "--times", "3", "--report", report], VALUES);
    assert.equal(result.code, 0);
    assert.match(result.out, /^pass  anna-first-item  replay 1 of 3/m);
    assert.match(result.out, /anna-first-item: 3 pass on 3 replays \(node-test\)/);

    type Report = {
      schema: string;
      times: number;
      traces: { id: string; sha256: string; recorded: string; replays: { outcome: string; durationMs: number; divergences: Record<string, string>[] }[] }[];
    };
    const text = readFileSync(report, "utf8");
    const written = JSON.parse(text) as Report;
    assert.equal(written.schema, "ecr.replays/0");
    assert.equal(written.times, 3);
    assert.deepEqual(written.traces.map((trace) => [trace.id, trace.recorded, trace.replays.map((entry) => entry.outcome)]), [
      ["anna-first-item", "pass", ["pass", "pass", "pass"]],
    ]);
    assert.match(written.traces[0]!.sha256, /^[0-9a-f]{64}$/);
    assert.equal(text.includes(exampleValues.PRIVATE_NOTE), false);
    assert.equal(text.includes(exampleValues.ITEM_TITLE), false);

    const bug = await ecr(["replay", BUG_TRACE, "--adapter", BUGGY, "--times", "2", "--report", report]);
    assert.equal(bug.code, 0);
    assert.match(bug.out, /anna-new-item-ticked: 2 bug on 2 replays/);
    const kept = readFileSync(report, "utf8");
    const stopped = JSON.parse(kept) as Report;
    assert.equal(stopped.traces[0]!.recorded, "known_bug");
    assert.deepEqual(stopped.traces[0]!.replays[1]!.divergences, [{ type: "oracle_failed", stepId: "s1", oracleId: "not-done-yet" }]);
    assert.equal(kept.includes("message"), false);

    const drifted = await ecr(["replay", TRACE, "--adapter", DRIFTED, "--times", "2", "--report", report], VALUES);
    assert.equal(drifted.code, 1);
    assert.match(drifted.err, /^FAIL  anna-first-item  replay 2 of 2 .*oracle_failed step s1/m);
    assert.match(drifted.out, /anna-first-item: 2 FAIL on 2 replays/);

    assert.equal((await ecr(["replay", TRACE, "--adapter", ADAPTER, "--times", "0"], VALUES)).code, 2);
    assert.equal((await ecr(["replay", TRACE, "--adapter", ADAPTER, "--times", "many"], VALUES)).code, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repair accepts a new action for the step that diverged, and writes the trace and its test", async () => {
  const dir = scratch();
  try {
    const copy = join(dir, "anna.trace.json");
    copyFileSync(join(root, TRACE), copy);
    const before = readFileSync(copy, "utf8");

    const broken = await ecr(["replay", copy, "--adapter", MOVED], VALUES);
    assert.equal(broken.code, 1);
    assert.match(broken.err, /target_not_found  step s3/);

    // A patch that gets past the step but breaks an oracle is refused, and nothing is written.
    const wrong = await ecr(["repair", copy, "--adapter", MOVED, "--step", "s3", "--action", '{"kind":"toggleAt","index":1}'], VALUES);
    assert.equal(wrong.code, 1);
    assert.match(wrong.err, /^REFUSED  anna-first-item  step s3 \(still_diverges\)/);
    assert.equal(readFileSync(copy, "utf8"), before);

    const right = await ecr(["repair", copy, "--adapter", MOVED, "--step", "s3", "--action", '{"kind":"toggleAt","index":0}'], VALUES);
    assert.equal(right.code, 0, right.err);
    assert.match(right.out, /^repaired  anna-first-item  step s3/);
    assert.match(right.out, /was: target_not_found  step s3/);
    // One action changed in the trace, and nothing else.
    const was = JSON.parse(before);
    const now = JSON.parse(readFileSync(copy, "utf8"));
    assert.deepEqual(now.steps[2].action, { kind: "toggleAt", index: 0 });
    now.steps[2].action = was.steps[2].action;
    assert.equal(`${JSON.stringify(now, null, 2)}\n`, before);
    assert.match(readFileSync(join(dir, "anna-first-item.test.mjs"), "utf8"), /app\.toggleAt\(0\);/);

    assert.equal((await ecr(["replay", copy, "--adapter", MOVED], VALUES)).code, 0);
    assert.equal((await ecr(["compile", copy, "--adapter", MOVED, "--check"])).code, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("repair refuses a failed oracle, and says what it needs", async () => {
  const oracle = await ecr(["repair", TRACE, "--adapter", DRIFTED, "--step", "s1", "--action", '{"kind":"add","title":"Anything"}'], VALUES);
  assert.equal(oracle.code, 1);
  assert.match(oracle.err, /\(oracle_failed\)/);
  assert.match(oracle.err, /a person decides/);

  assert.equal((await ecr(["repair", TRACE, "--adapter", MOVED, "--step", "s3"], VALUES)).code, 2);
  assert.equal((await ecr(["repair", TRACE, "--adapter", MOVED, "--step", "s3", "--action", "{not json"], VALUES)).code, 2);
  assert.match((await ecr(["repair", TRACE, "--adapter", MOVED, "--step", "s9", "--action", "{}"], VALUES)).err, /no step "s9"/);
});

test("conformance prints the report and fails when a law fails", async () => {
  const good = await ecr(["conformance", TRACE, "--adapter", ADAPTER], VALUES);
  assert.equal(good.code, 0);
  assert.match(good.out, /L7  No secret     pass/);

  const drifted = await ecr(["conformance", TRACE, "--adapter", DRIFTED], VALUES);
  assert.equal(drifted.code, 1);
  assert.match(drifted.out, /L2  Fidelity      fail/);
});
