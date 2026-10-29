/** Undo/redo stack of the editor. Generic: an entry is a pair of action lists (browser-safe). */
export interface HistoryEntry<A> {
  redo: A[];
  undo: A[];
}

export class History<A> {
  private done: HistoryEntry<A>[] = [];
  private undone: HistoryEntry<A>[] = [];

  /** Records a new user action; clears the redo branch. */
  push(entry: HistoryEntry<A>): void {
    this.done.push(entry);
    this.undone = [];
  }

  /** Returns the actions that revert the last entry, or undefined when there is nothing to undo. */
  undo(): A[] | undefined {
    const e = this.done.pop();
    if (!e) return undefined;
    this.undone.push(e);
    return e.undo;
  }

  redo(): A[] | undefined {
    const e = this.undone.pop();
    if (!e) return undefined;
    this.done.push(e);
    return e.redo;
  }
}
