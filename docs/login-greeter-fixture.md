# Restricted login UI fixture

The separate login preview under `apps/system/greeter/src/login` connects to an
explicitly injected C55 fixture controller. It does not replace the existing
in-session welcome or change production startup. Real authentication, canonical
account identity, native seat ownership, a restricted greeter compositor and
secure lock remain unimplemented.

Run the source and public Window workflows from the repository root:

```sh
./scripts/test-login-greeter.sh
pnpm --filter @moire/greeter typecheck
```

The view reuses shared fields, buttons, focus, accessibility and backdrop widgets.
One explicitly configured fixture session is visibly selected. Account text is
synthetic input, with no account enumeration. Sign in starts a fresh broker
transaction; visible and secret prompts submit one response, while information
and error prompts require explicit acknowledgement. Cancel and Escape cancel the
exact attempt. A denied transaction can be retried explicitly after confirmed
cleanup. Uncertain cleanup cannot retry or display a user desktop.

Each field draft belongs to its current prompt/attempt/catalog identity. A response
is cleared before submission and on identity change, cancellation, failure,
handoff, deactivation or unmount. Secret input uses the existing masked TextField;
responses never enter the controller's observed state, logs, preferences,
diagnostics or receipts. Secret responses cannot appear in rendered/captured text;
visible prompts intentionally display their synthetic visible draft. All tests use
synthetic input. JavaScript strings have no memory-zeroization guarantee.

The binding forwards the view's captured immutable request identities to C55. It
does not recapture a newer prompt or decide authentication itself. It detaches
input and presentation synchronously when C55 starts retiring the greeter. The
fixture lifecycle wrapper independently requires actual Window closure before
retiring the owned greeter process and descendants. A new login Window can appear
only after complete session cleanup and a fresh greeter identity. Another login
must start a fresh broker transaction. A fixture `running` state never establishes
real authenticated account authority.

Reduced motion defaults to true and uses explicitly supplied private disposable
storage. The store persists only a boolean, with saved/failed feedback. It never
discovers a user's home, loads `@moire/prefs` or calls the in-session
`Application.setSessionReducedMotion` API. Saving motion off cannot enable motion
on CPU, virtual or unknown execution. Native hardware qualification stays separate.

The focused tests use actual public Window pointer/keyboard dispatch and rendered
CPU pixels, plus the private fake greetd client and real harmless fixture process
authority. Two full cycles use UI login and explicit fixture-controller logout;
there is no desktop or logout UI. They cover prompt styles, cancellation, denial/retry, stale and repeated
requests, changed account/catalog, held handoff/cleanup, closure, console intent,
preference save/failure/reopen and compact/wide layouts with light/dark themes and
1/1.5 scale. Captures are fixture evidence, not screenshots of a secure native
login or lock screen.

The [C56 checkpoint](../vm/verification/2026-10-04-c56-login-greeter/README.md)
records the source gate, captures and preservation checks. C55 and earlier archives
and fallback images remain preserved. No real credentials, account/device access,
production authentication/PAM/service/Nix/security changes, image build or VM
lifecycle belong to this slice. Graphics/tearing and native typing remain
unqualified.
