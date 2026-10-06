# Authenticated-session supervisor source milestone

This source slice adds a fixed **unprivileged, post-PAM** entry and a harmless
probe. It does not authenticate, start a compositor, install a service, change
accounts, or activate a login image. The existing `moire-session` stays separate.

Run the focused command-fixture checks from the repository root:

```sh
./scripts/test-authenticated-session.sh
```

The checks spawn harmless local command processes on macOS or Linux. They verify
one unique unit name, exact start/stop arguments, normal completion, simulated
execution failure, SIGINT/SIGHUP/SIGTERM, repeated interruption, runtime bounds,
rejected/hung stops, CLI escalation, late registration and invalid fixture file
permissions. The manager fixture executes the actual fixed probe and observes
its harmless child closing. A deliberately killed manager fixture has a finite
five-second workload fallback. This is not a native cgroup cleanup test.
Both mocked command processes also have independent ten-second lifetimes. Test
cleanup observes their recorded process IDs exiting before removing temporary
files, including when an assertion fails.

## Fixed workload and ownership

`apps/system/session/moire-authenticated-session` runs its sibling
`moire-session-probe` through the current NixOS system's `systemd-run`. The probe
reports its kernel UID/GID and exits. The supervisor accepts no command argument
and refuses UID 0. Its name describes the caller's required post-authentication
placement; the entry itself cannot prove a PAM session exists.

The exact owned user service uses `--wait`, `Type=exec`, `ExitType=main`,
`Restart=no`, `KillMode=control-group`, a five-second stop limit, enabled SIGKILL
and a 30-second runtime cap. The supervisor has a 45-second command deadline.
The `--wait` contract monitors service deactivation, while service stop targets
remaining processes within that unit. See the pinned [systemd-run documentation](https://raw.githubusercontent.com/systemd/systemd/v260.4/man/systemd-run.xml)
and [systemd kill documentation](https://raw.githubusercontent.com/systemd/systemd/v260.4/man/systemd.kill.xml).

Normal successful completion exits 0. Abnormal completion stops only its exact
unit, waits for its command process, and preserves an ordinary failure or signal
exit status. Each cleanup command is bounded by eight seconds, followed by
bounded TERM/KILL escalation of that command's own PID. Exit 124 denotes the
run deadline. Exit 125 denotes unresolved cleanup and includes one bounded stop
retry for the same name. Exit 126 denotes rejected entry/configuration.

A successful early stop can precede unit registration. The retry and runtime cap
reduce that exposure but do not provide an atomic start/cancel barrier. Supervisor
SIGKILL or a crash cannot execute its cleanup handler. Exit 125 cannot force stock
greetd to block future logins. Native crash, late registration and service cleanup
remain qualification work. This implementation makes no all-descendants-gone
or hostile-user isolation guarantee.

The PAM/logind identity of a supervisor and the service cgroup are distinct.
A user service may run outside the original PAM session scope. Forwarding
`XDG_SESSION_ID` would not establish seat membership or DRM/input authority.
This source slice neither forwards such a claim nor qualifies graphics.

## Fixture boundary

`MOIRE_SESSION_FIXTURE_CONFIG` explicitly selects command-fixture mode. Its JSON
must be an owned mode-0600 regular file inside an owned mode-0700 directory. Its
two executable paths must be owned mode-0700 regular files in that same
directory. It has an exact schema and can only shorten native deadlines. The
test creates these files privately and deletes them afterward.

This injection is an unprivileged test interface, not a security boundary against
the same user. A future installed production entry must remove the fixture
environment variable in its fixed launcher. Receipts distinguish fixture mode
from `os-integration-unvalidated` and always report
`pamSessionIdentityVerified: false`. Raw command output, environment and error
text are omitted from supervisor logs.

The current host is macOS. No Linux user manager, PAM login, account provisioning,
image build, boot or seat access was exercised for this milestone. A proposed
native candidate is documented separately in
[Login probe candidate proposal](login-probe-candidate-proposal.md).
