# System management

Moire keeps resource policy out of both the compositor and its management
interfaces. Three pieces form the first system-management slice:

- `apps/system/management-service` owns Linux process inspection, protection
  policy, termination, and sustained memory-pressure detection.
- `apps/core/process-manager` is the general resource-management UI.
- `apps/core/memory-pressure` is a focused recovery UI opened after sustained
  critical pressure.

Both core applications are ordinary `@moire/ui` Wayland clients. They do not
read `/proc`, send signals, or reach into compositor state. Instead they use the
typed `@moire/system-management` client for the versioned
`org.moire.SystemManagement1` D-Bus interface.

## Process protection

The management service only exposes processes owned by the session user. It
marks the compositor, session, D-Bus, Xwayland, portal, management service, and
its own ancestor chain as protected. `Terminate` checks the live process again
and refuses requests for a protected process; disabling a button in the UI is
not the security boundary.

This is the beginning of the policy rather than its final form. Per-app cgroups
will let the service report and terminate whole application process trees,
enforce resource budgets, and isolate native applications as well as Node
clients.

## Memory pressure

The service samples Linux `MemAvailable`. After three consecutive samples at
or above 92% pressure it launches the recovery UI, with a cooldown after that
surface closes. The dialog lists the largest non-protected application
processes and offers graceful Quit actions plus a route to Process Manager.

Linux PSI, swap activity, reclaim stalls, and per-cgroup working sets should
eventually replace the initial percentage threshold. A minimal compositor-owned
emergency surface is still required for conditions where a new client cannot
be allocated or launched.
