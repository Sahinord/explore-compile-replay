/** The reference adapter on a system with a bug: a new item starts ticked. It explores and replays there. */
import { createFixtureAdapter } from "../../src/adapter.ts";
import { TodoApp } from "./behaviour-change.ts";

export default createFixtureAdapter({
  system: new URL("./behaviour-change.ts", import.meta.url).href,
  create: () => new TodoApp(),
});
