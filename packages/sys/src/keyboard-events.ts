/** Filter mirrored device nodes without dropping rapid input on one keyboard. */
export class KeyboardEventFilter {
  private recent = new Map<string, { source: number; timeMs: number }>();
  accept(source: number, event: { code: number; value: number; timeMs: number }): boolean {
    const key = `${event.code}:${event.value}`;
    const previous = this.recent.get(key);
    if (previous && previous.source !== source && Math.abs(event.timeMs - previous.timeMs) < 30)
      return false;
    this.recent.set(key, { source, timeMs: event.timeMs });
    return true;
  }
  clear(): void {
    this.recent.clear();
  }
}
