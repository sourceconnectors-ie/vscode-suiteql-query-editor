/**
 * Pure double-click detection, independent of `vscode.TreeView` — two `registerClick`
 * calls with the same (`===`) item within `thresholdMs` count as a double click. A
 * detected double click resets state, so a third rapid click on the same item starts a
 * fresh pair rather than double-counting.
 */
export class DoubleClickDetector<T> {
  private lastItem: T | undefined;
  private lastClickAt = 0;

  constructor(
    private readonly thresholdMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  registerClick(item: T): boolean {
    const clickedAt = this.now();
    const isDoubleClick = item === this.lastItem && clickedAt - this.lastClickAt <= this.thresholdMs;
    this.lastItem = isDoubleClick ? undefined : item;
    this.lastClickAt = clickedAt;
    return isDoubleClick;
  }
}
