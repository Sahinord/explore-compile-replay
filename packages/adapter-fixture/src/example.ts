/**
 * The example exploration of the reference adapter. The same steps feed
 * the tests, the conformance run and the files in `../examples/`.
 */
import type { RecordInput } from "../../core/src/index.ts";
import type { TodoAction, TodoOracle } from "./adapter.ts";

export const exampleValues = {
  ITEM_TITLE: "Buy bread",
  PRIVATE_NOTE: "Door code 4821",
} as const;

export const exampleExploration: RecordInput<TodoAction, TodoOracle> = {
  id: "anna-first-item",
  persona: {
    id: "anna",
    profile: "Retired teacher, 68, low patience with jargon.",
    goal: "Add her first item and tick it off.",
  },
  params: [
    { name: "ITEM_TITLE", secret: false, description: "Title of the item she adds" },
    { name: "PRIVATE_NOTE", secret: true, description: "A note she would not want in a repository" },
  ],
  values: exampleValues,
  agent: "hand-written example",
  now: () => new Date("2026-11-25T12:00:00.000Z"),
  invariants: [{ id: "first-item-kept", check: { kind: "has", title: { param: "ITEM_TITLE" } } }],
  steps: [
    {
      id: "s1",
      intent: "The list is empty, so she adds what she came for.",
      action: { kind: "add", title: { param: "ITEM_TITLE" } },
      checkpoints: [
        { id: "one-item", check: { kind: "count", equals: 1 } },
        { id: "not-done-yet", check: { kind: "done", title: { param: "ITEM_TITLE" }, equals: false } },
      ],
    },
    {
      id: "s2",
      intent: "She adds a private note to see if the list keeps several items.",
      action: { kind: "add", title: { param: "PRIVATE_NOTE" } },
      checkpoints: [{ id: "two-items", check: { kind: "count", equals: 2 } }],
    },
    {
      id: "s3",
      intent: "She ticks off the first item.",
      action: { kind: "toggle", title: { param: "ITEM_TITLE" } },
      checkpoints: [{ id: "done", check: { kind: "done", title: { param: "ITEM_TITLE" }, equals: true } }],
    },
    {
      id: "s4",
      intent: "She removes the note.",
      action: { kind: "remove", title: { param: "PRIVATE_NOTE" } },
      checkpoints: [{ id: "one-item-left", check: { kind: "count", equals: 1 } }],
    },
  ],
};
