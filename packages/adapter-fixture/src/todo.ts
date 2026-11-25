/**
 * The system under test of the reference adapter: a to-do list in memory.
 *
 * It is deliberately tiny. Its only job is to give the contract and the
 * conformance kit something real to drive, compile for and replay against.
 */
export interface Todo {
  readonly title: string;
  readonly done: boolean;
}

/** Thrown when an action names an item that is not in the list. */
export class TargetNotFound extends Error {
  override name = "TargetNotFound";
}

export class TodoApp {
  #items: Todo[] = [];

  add(title: string): void {
    if (title.trim() === "") throw new Error("A title is required");
    this.#items.push({ title, done: false });
  }

  toggle(title: string): void {
    const index = this.#find(title);
    const item = this.#items[index] as Todo;
    this.#items[index] = { title: item.title, done: !item.done };
  }

  /** Ticks or unticks the item at a position, counted from 0. A second way to name an item. */
  toggleAt(index: number): void {
    const item = this.#items[index];
    if (!item) throw new TargetNotFound(`No item at position ${index}`);
    this.#items[index] = { title: item.title, done: !item.done };
  }

  remove(title: string): void {
    this.#items.splice(this.#find(title), 1);
  }

  state(): Todo[] {
    return this.#items.map((item) => ({ ...item }));
  }

  load(items: readonly Todo[]): void {
    this.#items = items.map((item) => ({ ...item }));
  }

  #find(title: string): number {
    const index = this.#items.findIndex((item) => item.title === title);
    if (index === -1) throw new TargetNotFound(`No item titled "${title}"`);
    return index;
  }
}
