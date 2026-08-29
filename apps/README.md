# Moire application classes

Moire classifies applications by their role and authority, not by who ships
them. A first-party application is not automatically a core application.

The categories below define architectural and security boundaries. The
repository groups source by these classes, but directory placement alone must
never grant an application additional authority.

## Core applications

Core applications provide user interfaces for managing operating-system
functionality, resources, or policy. They may receive narrowly scoped system
capabilities that ordinary applications cannot receive.

Examples include:

- Settings surfaces that change system-wide configuration
- Process management, Force Quit, and memory-pressure recovery
- Display, input, network, storage, power, and account administration

Current core applications are Settings, Process Manager, and the Memory
Pressure recovery surface.

A core application must:

- Manage an OS facility rather than merely consume it
- Declare every privileged capability it needs
- Keep privileged operations behind a typed service boundary
- Use public UI and client APIs for presentation wherever possible
- Remain replaceable without moving policy into the compositor
- Provide a degraded or emergency path when system resources are exhausted

Core is deliberately a small category. File browsing, launching applications,
choosing a file, and opening a document are not OS administration and do not
become core merely because the desktop depends on them.

## System applications

System applications participate in the desktop session or broker access
between applications, but do not administer the operating system. They may be
trusted session components while still operating through explicit protocols
and portals.

Examples include:

- Shell and application launcher surfaces
- Open With and file-picker portal surfaces
- Authentication or permission prompts
- Session UI that brokers an application choice

System applications receive only the capability needed to perform their
broker role. A portal may ask a privileged service to perform an operation; it
does not inherit unrestricted access to that service.

## Bundled applications

Bundled applications are first-party applications supplied with Moire. They
have the same default authority as third-party applications and are expected to
exercise the public application, widget, portal, and Wayland APIs.

Current examples include:

- Files
- Terminal

Bundled applications are important dogfood. If one needs an internal escape
hatch for normal application behavior, the public platform is probably
incomplete.

## Developer applications

Developer applications exist to explain, inspect, benchmark, or stress the
platform. They must not be required for a normal desktop session.

Current examples include:

- Widget Showcase
- Benchmark

Diagnostics may observe additional telemetry when explicitly enabled, but
they should not silently acquire administrative authority.

## Services and infrastructure are not applications

The compositor, session manager, D-Bus services, portals backends, and policy
engines may expose application-facing UI, but their non-UI responsibilities do
not make them core applications. Long-lived services belong with the subsystem
they implement; interactive surfaces should remain separable clients whenever
the recovery model permits it.

In particular:

- The compositor owns display composition, input routing, and protocol state.
- The session manager owns application lifecycle and per-app resource groups.
- Policy services decide whether an operation is allowed.
- Core and system applications present choices and status to the user.

This separation lets a UI crash without taking down the facility it manages,
and lets Moire retain a minimal compositor-owned emergency surface for failures
such as critical memory pressure.

## Placement test

Before adding an application, ask these questions in order:

1. Does it administer an OS resource or policy? Place it in **core**.
2. Does it broker or participate in the desktop session? Place it in
   **system**.
3. Is it a normal first-party user application? Place it in **bundled**.
4. Is it primarily diagnostic, educational, or a stress test? Place it in
   **developer**.

If two answers appear to apply, split the privileged service or broker from the
ordinary UI. Do not resolve ambiguity by granting the whole application core
status.

## Repository shape

The source tree makes these roles visible:

```text
apps/
  core/       OS administration and recovery UI
  system/     shell and broker surfaces
  bundled/    ordinary first-party applications
  developer/  diagnostics, examples, and stress tests
```

Application manifests and the session policy remain the source of truth for
authority. The directories make the distinction visible to contributors; they
do not act as a security model.
