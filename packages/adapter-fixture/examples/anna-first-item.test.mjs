// Compiled by Explore-Compile-Replay: https://github.com/pierridotite/explore-compile-replay
// Trace: anna-first-item
// Trace hash: sha256:bdb80b32bf5017f4f615120fe32de10e81a0e9c683801eff1c9cefaa3a1df697
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
const params = {"ITEM_TITLE": param("ITEM_TITLE"), "PRIVATE_NOTE": param("PRIVATE_NOTE")};

test("anna: Add her first item and tick it off.", () => {
  const app = new TodoApp();
  let at = null;
  try {
    // Step s1: The list is empty, so she adds what she came for.
    at = {"kind":"step","stepId":"s1"};
    app.add(params["ITEM_TITLE"]);
    at = {"kind":"oracle","stepId":"s1","oracleId":"one-item"};
    assert.equal(app.state().length, 1);
    at = {"kind":"oracle","stepId":"s1","oracleId":"not-done-yet"};
    assert.equal(app.state().find((item) => item.title === params["ITEM_TITLE"])?.done, false);
    at = {"kind":"oracle","stepId":"s1","oracleId":"first-item-kept"};
    assert.ok(app.state().some((item) => item.title === params["ITEM_TITLE"]));
    // Step s2: She adds a private note to see if the list keeps several items.
    at = {"kind":"step","stepId":"s2"};
    app.add(params["PRIVATE_NOTE"]);
    at = {"kind":"oracle","stepId":"s2","oracleId":"two-items"};
    assert.equal(app.state().length, 2);
    at = {"kind":"oracle","stepId":"s2","oracleId":"first-item-kept"};
    assert.ok(app.state().some((item) => item.title === params["ITEM_TITLE"]));
    // Step s3: She ticks off the first item.
    at = {"kind":"step","stepId":"s3"};
    app.toggle(params["ITEM_TITLE"]);
    at = {"kind":"oracle","stepId":"s3","oracleId":"done"};
    assert.equal(app.state().find((item) => item.title === params["ITEM_TITLE"])?.done, true);
    at = {"kind":"oracle","stepId":"s3","oracleId":"first-item-kept"};
    assert.ok(app.state().some((item) => item.title === params["ITEM_TITLE"]));
    // Step s4: She removes the note.
    at = {"kind":"step","stepId":"s4"};
    app.remove(params["PRIVATE_NOTE"]);
    at = {"kind":"oracle","stepId":"s4","oracleId":"one-item-left"};
    assert.equal(app.state().length, 1);
    at = {"kind":"oracle","stepId":"s4","oracleId":"first-item-kept"};
    assert.ok(app.state().some((item) => item.title === params["ITEM_TITLE"]));
  } catch (error) {
    console.error("ECR_DIVERGENCE " + JSON.stringify({ ...at, name: error?.name, message: error?.message }));
    throw error;
  }
});
