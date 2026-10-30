/**
 * zwp_idle_inhibit_manager_v1 bookkeeping. An inhibitor holds the session awake only while its
 * surface is visible (mapped, with content, not minimized), as the protocol specifies.
 */

type InhibitorKey<Session> = { session: Session; objectId: number };

export class IdleInhibitorRegistry<Session> {
  private readonly inhibitors = new Map<Session, Map<number, number>>();
  private readonly listeners = new Set<() => void>();

  /** `objectId` is the zwp_idle_inhibitor_v1 id, `surfaceId` the wl_surface it is bound to. */
  create(session: Session, objectId: number, surfaceId: number): void {
    const owned = this.inhibitors.get(session) ?? new Map<number, number>();
    owned.set(objectId, surfaceId);
    this.inhibitors.set(session, owned);
    this.notify();
  }

  destroy(session: Session, objectId: number): void {
    const owned = this.inhibitors.get(session);
    if (!owned?.delete(objectId)) return;
    if (owned.size === 0) this.inhibitors.delete(session);
    this.notify();
  }

  /** A client went away; its inhibitors go with it. */
  retireSession(session: Session): void {
    if (this.inhibitors.delete(session)) this.notify();
  }

  /** Inhibitors whose surface is currently visible. `live` drops departed clients. */
  active(
    live: (session: Session) => boolean,
    visible: (session: Session, surfaceId: number) => boolean,
  ): InhibitorKey<Session>[] {
    const result: InhibitorKey<Session>[] = [];
    for (const [session, owned] of this.inhibitors) {
      if (!live(session)) {
        this.inhibitors.delete(session);
        continue;
      }
      for (const [objectId, surfaceId] of owned)
        if (visible(session, surfaceId)) result.push({ session, objectId });
    }
    return result;
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of Array.from(this.listeners)) listener();
  }
}
