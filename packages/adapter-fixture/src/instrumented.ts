/**
 * An instrumented to-do list, for law L2: it does what the system at
 * `ECR_FIXTURE_INNER` does, and notes each call it receives, one JSON line
 * per call, in the file at `ECR_FIXTURE_NOTES`.
 *
 * An action is noted in the vocabulary of the adapter. An oracle is seen
 * as one read of the state: the system cannot know what the test then
 * compares.
 */
import { appendFileSync } from "node:fs";
import type { TodoApp as Reference, Todo } from "./todo.ts";

const { TodoApp: Inner } = (await import(process.env.ECR_FIXTURE_INNER as string)) as { TodoApp: typeof Reference };

function note(entry: unknown): void {
  appendFileSync(process.env.ECR_FIXTURE_NOTES as string, `${JSON.stringify(entry)}\n`);
}

export class TodoApp extends Inner {
  override add(title: string): void {
    note({ kind: "action", action: { kind: "add", title } });
    super.add(title);
  }

  override toggle(title: string): void {
    note({ kind: "action", action: { kind: "toggle", title } });
    super.toggle(title);
  }

  override toggleAt(index: number): void {
    note({ kind: "action", action: { kind: "toggleAt", index } });
    super.toggleAt(index);
  }

  override remove(title: string): void {
    note({ kind: "action", action: { kind: "remove", title } });
    super.remove(title);
  }

  override state(): Todo[] {
    note({ kind: "oracle" });
    return super.state();
  }
}
