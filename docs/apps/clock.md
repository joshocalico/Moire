# Clock

`@moire/clock` combines a live clock, countdown timer, stopwatch and daily
alarms. Its command is `moire-clock`, desktop entry is `moire-clock.desktop`,
and app ID is `org.moire.Clock`.

Choose a tab in the toolbar. Timer accepts `minutes:seconds` or
`hours:minutes:seconds`; Start, Pause and Resume control the countdown. Reset
returns to the entered duration. The stopwatch supports pause, resume, laps
and reset. Both elapsed timing functions use a monotonic clock so changes to
the computer's date and time do not alter their durations.

Alarms use local 24-hour times and repeat daily. Add a named alarm, enable or
disable it with its checkbox, or delete it. A due alarm displays an alert.
Each timer or alarm receives its own notice. Next notice switches between
pending notices; Dismiss closes the selected notice. Snooze 5m reschedules
only the selected alarm for five minutes later. Resetting a timer does not
erase an existing notice. The launcher requests a terminal bell when an alert fires;
audibility depends on the launching environment.

Alarms and timers run only while the window is open. Alarm definitions are
stored atomically in `$XDG_DATA_HOME/moire/clock/alarms.json`, defaulting to
`~/.local/share/moire/clock/alarms.json`. Restarting restores daily definitions,
but discards active snoozes, countdowns, stopwatch progress and laps. There is
no background alarm daemon or system notification delivery.

If another window changes saved alarms, a save keeps the current input and
shows a conflict. Keep draft leaves it here; Reload saved reads the latest
definitions while retaining the input, running timer, stopwatch and pending
notices. Saving again is a separate action. Malformed data, unknown save locks
and failed publication preserve the existing file and report an error.

Run `pnpm --filter @moire/clock smoke` for duration calculations and actual
Window timer completion, alarm persistence and lifecycle input.
