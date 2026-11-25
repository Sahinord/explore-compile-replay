/** Drift that a test must catch: a new item now starts as done. */
import { TodoApp as Reference } from "../../src/todo.ts";

export class TodoApp extends Reference {
  override add(title: string): void {
    super.add(title);
    super.toggle(title);
  }
}
