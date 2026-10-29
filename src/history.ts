/** Undo/redo stack of the editor. Generic: an entry is a pair of action lists (browser-safe). */
import type { LayoutAction } from "./save.js";
import type { Pins } from "./layout.js";

export interface HistoryEntry {
  redo: LayoutAction[];
  undo: LayoutAction[];
}

export class History {
  private done: HistoryEntry[] = [];
  private undone: HistoryEntry[] = [];

  /** Records a new user action; clears the redo branch. */
  push(entry: HistoryEntry): void {
    this.done.push(entry);
    this.undone = [];
  }

  /** Returns the actions that revert the last entry, or undefined when there is nothing to undo. */
  undo(): LayoutAction[] | undefined {
    const e = this.done.pop();
    if (!e) return undefined;
    this.undone.push(e);
    return e.undo;
  }

  redo(): LayoutAction[] | undefined {
    const e = this.undone.pop();
    if (!e) return undefined;
    this.done.push(e);
    return e.redo;
  }
}

/** The actions that restore `pins` for the things `actions` touch (the undo half of an entry). */
export function inverseOf(actions: LayoutAction[], pins: Pins): LayoutAction[] {
  const inv: LayoutAction[] = [];
  for (const a of [...actions].reverse()) {
    if (a.type === "unpinAll") {
      for (const [name, old] of Object.entries(pins.classes ?? {})) inv.push({ type: "pinClass", name, ...old });
    } else if (a.type === "pinAll") {
      for (const name of Object.keys(a.classes)) {
        const old = pins.classes?.[name];
        inv.push(old ? { type: "pinClass", name, ...old } : { type: "unpinClass", name });
      }
    } else if (a.type === "pinClass" || a.type === "unpinClass") {
      const old = pins.classes?.[a.name];
      inv.push(old ? { type: "pinClass", name: a.name, ...old } : { type: "unpinClass", name: a.name });
    } else {
      const old = pins.relations?.[a.key]?.bends;
      inv.push({ type: "setBends", key: a.key, bends: old ? old.map((b) => [...b] as [number, number]) : null });
    }
  }
  return inv;
}
