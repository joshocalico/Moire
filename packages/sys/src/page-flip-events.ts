import koffi from "koffi";

export const DrmPageFlipHandler2 = koffi.proto(
  "void MoireDrmPageFlipHandler2(int fd, unsigned int sequence, unsigned int tv_sec, unsigned int tv_usec, unsigned int crtc_id, void *user_data)",
);

/** Preserve opaque user_data addresses until the kernel event arrives or the fd closes. */
export class PageFlipEvents<Output> {
  private readonly events = new Map<
    bigint,
    {
      output: Output;
      token: number;
      allocation: unknown;
    }
  >();

  allocate(output: Output, token: number): unknown {
    const allocation = koffi.alloc("uint64_t", 1);
    this.events.set(BigInt(koffi.address(allocation)), { output, token, allocation });
    return allocation;
  }

  consume(userData: unknown): { output: Output; token: number } | null {
    if (userData == null) return null;
    const address = BigInt(koffi.address(userData));
    const event = this.events.get(address);
    if (!event) return null;
    this.events.delete(address);
    koffi.free(event.allocation);
    return { output: event.output, token: event.token };
  }

  /** A rejected ioctl never queues an event, so its token can be freed immediately. */
  cancel(userData: unknown): void {
    this.consume(userData);
  }

  /** Call after event dispatch stops and the owning fd is closing. */
  destroy(): void {
    for (const event of this.events.values()) koffi.free(event.allocation);
    this.events.clear();
  }
}
