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

test("conformance prints the report and fails when a law fails", async () => {
  const good = await ecr(["conformance", TRACE, "--adapter", ADAPTER], VALUES);
  assert.equal(good.code, 0);
  assert.match(good.out, /L7  No secret     pass/);

  const drifted = await ecr(["conformance", TRACE, "--adapter", DRIFTED], VALUES);
  assert.equal(drifted.code, 1);
  assert.match(drifted.out, /L2  Fidelity      fail/);
});
