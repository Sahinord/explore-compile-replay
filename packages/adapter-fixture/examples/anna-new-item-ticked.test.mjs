// Compiled by Explore-Compile-Replay: https://github.com/pierridotite/explore-compile-replay
// Trace: anna-new-item-ticked
// Trace hash: sha256:7ba15aa9768b1cbccbbbf8eec5757ed82e1604630dcd4b6fff241453ae0b8521
// Do not edit by hand. Change the trace and compile again.
// Run: ECR_FIXTURE_SYSTEM=<URL of the module that exports TodoApp> node <this file>
import assert from "node:assert/strict";
import { test } from "node:test";

const { TodoApp } = await import(process.env.ECR_FIXTURE_SYSTEM);

// Values supplied when the test runs. They are never written in this file.
function param(name) {
  const value = process.env["ECR_PARAM_" + name];
  if (value === undefined) throw new Error("Missing value for parameter " + name);
  return value;
}
const params = {};

test("anna: Add her first item and find it waiting, not ticked.", () => {
  const app = new TodoApp();
  let at = null;
  try {
    // Step s1: She adds bread and expects it to wait for her, not ticked.
    at = {"kind":"step","stepId":"s1"};
    app.add("Bread");
    at = {"kind":"oracle","stepId":"s1","oracleId":"one-item"};
    assert.equal(app.state().length, 1);
    at = {"kind":"oracle","stepId":"s1","oracleId":"not-done-yet"};
    // Known bug: this check was false when the trace was recorded. It fails until the bug is fixed.
    assert.equal(app.state().find((item) => item.title === "Bread")?.done, false);
    at = {"kind":"oracle","stepId":"s1","oracleId":"bread-kept"};
    assert.ok(app.state().some((item) => item.title === "Bread"));
    // Step s2: She adds milk all the same.
    at = {"kind":"step","stepId":"s2"};
    app.add("Milk");
    at = {"kind":"oracle","stepId":"s2","oracleId":"two-items"};
    assert.equal(app.state().length, 2);
    at = {"kind":"oracle","stepId":"s2","oracleId":"bread-kept"};
    assert.ok(app.state().some((item) => item.title === "Bread"));
  } catch (error) {
    console.error("ECR_DIVERGENCE " + JSON.stringify({ ...at, name: error?.name, message: error?.message }));
    throw error;
  }
});
