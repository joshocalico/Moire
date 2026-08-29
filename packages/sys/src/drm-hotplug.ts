import koffi from "koffi";
import { assertLinux } from "./platform";

const POLLIN = 0x0001;

const PollFd = koffi.struct("pollfd_drm_hotplug", {
  fd: "int",
  events: "short",
  revents: "short",
});

export type DrmHotplugEvent = {
  action: string;
  devnode: string | null;
  sysname: string | null;
};

export type DrmHotplugMonitor = {
  stop(): void;
};

function loadLibudev() {
  for (const name of ["libudev.so.1", "libudev.so"]) {
    try {
      return koffi.load(name);
    } catch {
      // Try the unversioned development-library name next.
    }
  }
  throw new Error("Failed to load libudev");
}

/**
 * Observe kernel DRM change events without shelling out to udevadm. The monitor
 * is deliberately independent from KMS/rendering: consumers decide how and
 * when to re-probe their outputs.
 */
export function watchDrmHotplug(
  onChange: (event: DrmHotplugEvent) => void,
  pollIntervalMs = 250,
): DrmHotplugMonitor {
  assertLinux("DRM hotplug monitor");

  const libudev = loadLibudev();
  const libc = koffi.load("libc.so.6");
  const poll = libc.func("int poll(void *fds, unsigned long nfds, int timeout)");
  const udevNew = libudev.func("void *udev_new(void)");
  const udevUnref = libudev.func("void *udev_unref(void *udev)");
  const monitorNew = libudev.func(
    "void *udev_monitor_new_from_netlink(void *udev, const char *name)",
  );
  const monitorUnref = libudev.func("void *udev_monitor_unref(void *monitor)");
  const monitorFilter = libudev.func(
    "int udev_monitor_filter_add_match_subsystem_devtype(void *monitor, const char *subsystem, const char *devtype)",
  );
  const monitorEnable = libudev.func("int udev_monitor_enable_receiving(void *monitor)");
  const monitorGetFd = libudev.func("int udev_monitor_get_fd(void *monitor)");
  const monitorReceive = libudev.func("void *udev_monitor_receive_device(void *monitor)");
  const deviceUnref = libudev.func("void *udev_device_unref(void *device)");
  const deviceGetAction = libudev.func("const char *udev_device_get_action(void *device)");
  const deviceGetDevnode = libudev.func("const char *udev_device_get_devnode(void *device)");
  const deviceGetSysname = libudev.func("const char *udev_device_get_sysname(void *device)");

  const udev = udevNew();
  if (!udev) throw new Error("udev_new failed");
  const monitor = monitorNew(udev, "udev");
  if (!monitor) {
    udevUnref(udev);
    throw new Error("udev_monitor_new_from_netlink failed");
  }

  if (monitorFilter(monitor, "drm", null) < 0 || monitorEnable(monitor) < 0) {
    monitorUnref(monitor);
    udevUnref(udev);
    throw new Error("Failed to enable DRM udev monitor");
  }
  const fd = monitorGetFd(monitor) as number;
  if (fd < 0) {
    monitorUnref(monitor);
    udevUnref(udev);
    throw new Error("udev monitor returned an invalid fd");
  }

  const pollFd = koffi.alloc(PollFd, 1);
  let stopped = false;
  const timer = setInterval(
    () => {
      if (stopped) return;
      koffi.encode(pollFd, PollFd, { fd, events: POLLIN, revents: 0 });
      if ((poll(pollFd, 1, 0) as number) <= 0) return;
      const ready = koffi.decode(pollFd, PollFd) as { revents: number };
      if (!(ready.revents & POLLIN)) return;

      for (;;) {
        const device = monitorReceive(monitor);
        if (!device) break;
        try {
          onChange({
            action: String(deviceGetAction(device) ?? "change"),
            devnode: nullableString(deviceGetDevnode(device)),
            sysname: nullableString(deviceGetSysname(device)),
          });
        } finally {
          deviceUnref(device);
        }
      }
    },
    Math.max(50, pollIntervalMs),
  );
  timer.unref?.();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      koffi.free(pollFd);
      monitorUnref(monitor);
      udevUnref(udev);
    },
  };
}

function nullableString(value: unknown): string | null {
  return value == null ? null : String(value);
}
