/** Presentation handoff inside an already authorized desktop session. */
export class StartupDesktop {
  private active = false;
  constructor(private readonly attach: () => void) {}
  start(): boolean {
    if (!this.active) {
      this.attach();
      this.active = true;
    }
    return true;
  }
}
