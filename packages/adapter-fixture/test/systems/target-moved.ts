/** Drift that a repair may fix: items are still there, but no longer found by their title. */
import { TargetNotFound, TodoApp as Reference } from "../../src/todo.ts";

export class TodoApp extends Reference {
  override toggle(title: string): void {
    throw new TargetNotFound(`No item titled "${title}"`);
  }
}
