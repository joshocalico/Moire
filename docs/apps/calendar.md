# Calendar

`@moire/calendar` provides a local month calendar and daily agenda. Its command
is `moire-calendar`, desktop entry is `moire-calendar.desktop`, and app ID is
`org.moire.Calendar`.

Select a day to see its events. Today returns to the current date; the month
arrows move through the year. Search matches event titles and notes across all
dates. New Event or Ctrl+N opens the editor. Enter a title, date, start and end
times, an IANA time zone such as `Australia/Adelaide`, and optional notes. Save
or Ctrl+S saves the event. Edit changes the selected event; Delete asks for
confirmation.

The month and agenda use the computer's local time zone. Each event retains
its own time zone and stores its start and end as UTC timestamps. Daylight
saving gaps are rejected. An ambiguous time during the autumn clock change
uses the earlier occurrence. Events must end after they start on the same
entered date. Recurring, all-day and multi-day events are not supported.

Events are stored atomically in
`$XDG_DATA_HOME/moire/calendar/events.json`, defaulting to
`~/.local/share/moire/calendar/events.json`. An unreadable or malformed file
shows an error and blocks saves, preserving the existing file. There is no
cloud synchronization or account requirement.

If another window saves an event, this window keeps its draft and blocks a
stale overwrite. Keep draft retains the input; Reload saved reads the current
events without discarding it. Save again deliberately after reviewing the
updated events. Unknown or active save locks produce a bounded error.

The event editor scrolls at compact sizes and keeps Save and Cancel visible.
Closing a window with an edited event asks Save, Discard or Cancel. Invalid
input, a storage conflict or a failed save keeps the window and draft open.

Run `pnpm --filter @moire/calendar smoke` for date and daylight saving checks,
persistence, and actual Window keyboard creation and pointer editing.
