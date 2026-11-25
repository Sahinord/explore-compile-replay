import assert from "node:assert/strict";
import { test } from "node:test";
import type { CompiledArtifact } from "../../../spec/schema.ts";
import { canonicalJson, checkSourceMap, hashTrace, isParamRef, resolveParams } from "../src/index.ts";

test("canonicalJson does not depend on key order", () => {
  assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("hashTrace is stable across key order and changes with the content", () => {
  assert.equal(hashTrace({ id: "t", steps: [1, 2] }), hashTrace({ steps: [1, 2], id: "t" }));
  assert.notEqual(hashTrace({ id: "t", steps: [1, 2] }), hashTrace({ id: "t", steps: [2, 1] }));
  assert.match(hashTrace({}), /^[0-9a-f]{64}$/);
});

test("isParamRef accepts only { param: string }", () => {
  assert.equal(isParamRef({ param: "NAME" }), true);
  assert.equal(isParamRef({ param: "NAME", other: 1 }), false);
  assert.equal(isParamRef({ param: 1 }), false);
  assert.equal(isParamRef("NAME"), false);
  assert.equal(isParamRef(null), false);
});

test("resolveParams replaces references at any depth and fails on a missing value", () => {
  const action = { kind: "type", text: { param: "TITLE" }, targets: [{ label: { param: "LABEL" } }] };
  assert.deepEqual(resolveParams(action, { TITLE: "Bread", LABEL: "Title" }), {
    kind: "type",
    text: "Bread",
    targets: [{ label: "Title" }],
  });
  assert.throws(() => resolveParams(action, { TITLE: "Bread" }), /LABEL/);
});

function artifact(lines: number, sourceMap: CompiledArtifact["sourceMap"]): CompiledArtifact {
  return { target: "t", path: "a.test.mjs", content: Array(lines).fill("x").join("\n"), traceHash: "h", sourceMap };
}

test("checkSourceMap accepts one distinct range per step", () => {
  const map = [
    { stepId: "s1", startLine: 2, endLine: 4 },
    { stepId: "s2", startLine: 5, endLine: 5 },
  ];
  assert.deepEqual(checkSourceMap(artifact(6, map), ["s1", "s2"]), []);
});

test("checkSourceMap reports every kind of problem", () => {
  const problems = checkSourceMap(
    artifact(6, [
      { stepId: "s1", startLine: 2, endLine: 4 },
      { stepId: "s1", startLine: 4, endLine: 5 },
      { stepId: "ghost", startLine: 6, endLine: 9 },
      { stepId: "s3", startLine: 3, endLine: 1 },
    ]),
    ["s1", "s2", "s3"],
  ).join("\n");
  assert.match(problems, /step s1 has 2 ranges/);
  assert.match(problems, /step s2 has no range/);
  assert.match(problems, /unknown step ghost/);
  assert.match(problems, /step ghost ends after the last line/);
  assert.match(problems, /step s3 ends before it starts/);
  assert.match(problems, /overlap/);
});
