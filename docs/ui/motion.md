# Motion

Lightweight exponential easing for UI properties. Used by `Pressable` hover/press; available for selection washes and other chrome.

## API

```ts
import { createMotionValue, easeTo, tickAllMotions } from "@moire/ui";

const mv = createMotionValue(0);
easeTo(mv, 1, 18);        // target 1, speed 18 (optional; default 14)
const v = mv.get();       // current value
mv.set(0);                // jump
tickAllMotions(dt);       // seconds; returns true if still moving
```

| Piece | Behavior |
| --- | --- |
| Registry | Every `createMotionValue` is ticked globally |
| Integration | `Window.tick` and shell `needsRepaint` call `tickAllMotions` |
| Settle | Stops when \|target − value\| &lt; 0.5 |

There is no separate `springTo` — use `easeTo` with speed.

## Pressable

On enter/leave/down/up, Pressable eases internal hover/press amounts and lerps `fill` between base, `pal.hover`, and `pal.pressed`. Apps that use motion values must ensure a tick loop marks the window dirty while values move (Window already does this).

## Shell

Desktop/panel Pressables live in the compositor process. Shell `needsRepaint()` ticks motions and returns true while they settle so the composite loop keeps painting.
