# C55 source fixture contract

Scope is one configured Wayland session. Every broker/controller/lifecycle authority
is explicitly fixture-qualified and injected. No production imports, automatic
GREETD_SOCK connection, account or real credential queries, authentication/PAM,
service/Nix/security edits, session wrapper/compositor changes, device access,
image builds or VM lifecycle. C54 and older archives are immutable.

Shared src/types.ts is root-owned. Read it before work; propose contract corrections
to root rather than changing it. Each owner edits only assigned modules/smokes.
No speculative general framework. Prefer direct contracts and strict boundary
parsing. Log/state/errors contain no synthetic response or command/environment
secret. A successful broker conversation permits a launch request; it never proves
a running native session. No homegrown password verifier or privileged broker.

The only broker command is a fixed trusted launcher plus a restricted opaque ID.
Descriptor text is independently revalidated against generation and executed as
argv without a shell. Trusted catalog roots are explicitly configured; one entry,
no account/system enumeration, no user writable application catalog. Future OS
authentication activation and native seat authorities remain unimplemented.

Controller ordering follows greetd: authorized -> request scheduled launch ->
retire greeter completely -> observe fixture started -> running. Scheduling is not
launch completion. Wrong/late replies cannot revive retired attempts. Every
new graphical admission checks current console intent. Cancel/failure/timeout
must prove no owned pending launch before ready; uncertainty remains blocked.
Logout waits complete owned descendant cleanup before fresh greeter generation
and requires fresh authentication. Never identify ownership by a PID alone.

Tests use private UNIX sockets for real frame fragmentation/EOF/protocol behavior,
strict phase/identity/catalog tests, real harmless subprocess argv oracles and
owned fixture descendants. Prove held acknowledgements, changed generations,
unknown cleanup, stale identities, console intent, repeated cancellation and
successful full vertical login -> running -> logout -> complete cleanup -> fresh
login requiring new broker authentication. No placeholder UI is added. Secure lock
and real authenticated login are explicitly unimplemented.

Root integrates the modules and owns the focused repeatable runner, vertical smoke,
documentation and source-only checkpoint. Freeze owned source after focused checks;
final combined gate records actual exit codes and stable hashes of tested files.
