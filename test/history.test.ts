import { describe, expect, it } from "vitest";
import { History, inverseOf } from "../src/history.js";

describe("History", () => {
  it("undoes and redoes in order, and a new action clears redo", () => {
    const h = new History();
    h.push({ redo: [{ type: "unpinClass", name: "A" }], undo: [{ type: "pinClass", name: "A", x: 1, y: 2 }] });
    expect(h.undo()).toEqual([{ type: "pinClass", name: "A", x: 1, y: 2 }]);
    expect(h.undo()).toBeUndefined();
    expect(h.redo()).toEqual([{ type: "unpinClass", name: "A" }]);
    h.undo();
    h.push({ redo: [], undo: [] });
    expect(h.redo()).toBeUndefined();
  });

  it("inverseOf restores the previous pin or unpins", () => {
    const pins = { classes: { A: { x: 10, y: 20 } }, relations: {} };
    const inv = inverseOf(
      [
        { type: "pinClass", name: "A", x: 50, y: 50 },
        { type: "pinClass", name: "B", x: 0, y: 0 },
        { type: "setBends", key: "k", bends: [[1, 1]] },
      ],
      pins,
    );
    expect(inv).toEqual([
      { type: "setBends", key: "k", bends: null },
      { type: "unpinClass", name: "B" },
      { type: "pinClass", name: "A", x: 10, y: 20 },
    ]);
  });
});
