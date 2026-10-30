/**
 * Calendar workflows through a real Window: a coloured weekly event made in the editor, the week
 * view with its keyboard navigation and remembered choice, and importing .ics files through the
 * shared file chooser. Set MOIRE_CALENDAR_CAPTURE_DIR to also save PNGs of the week view.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { loadRecentFiles } from "@moire/app-tools";
import { mountWindow, windowControl, withFixture } from "@moire/app-tools/testing";
import {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  setUiScaleFactor,
} from "@moire/ui";
import { APP_ID, CalendarStore, loadViewMode, saveViewMode } from "./events";
import { CalendarApp } from "./main";
import { eventFromDraft, newDraft, type EventDraft } from "./model";

// Every date below is a UTC wall-clock date; the app shows the computer's zone.
process.env.TZ = "UTC";
const capture = process.env.MOIRE_CALENDAR_CAPTURE_DIR;
const theme = createPersonalizedWidgetTheme(
  discoverPersonalization("linux", {
    themeFamily: "moire",
    colorScheme: "dark",
    reducedMotion: true,
  }),
);
const NOW = Date.parse("2026-10-07T10:20:00Z"); // a Wednesday
const KEY = { n: 49, s: 31, o: 24, t: 20, a: 30, "1": 2, "2": 3 } as const;
const ARROW = { ArrowLeft: 105, ArrowRight: 106, ArrowDown: 108 } as const;
const seed = (overrides: Partial<EventDraft>) =>
  eventFromDraft({ ...newDraft("2026-10-07", "UTC"), ...overrides });

await withFixture(async (home) => {
  const store = new CalendarStore(path.join(home, "events.json"));
  store.write(
    [
      seed({ title: "Design review", start: "09:00", end: "10:30", color: "purple" }),
      seed({ title: "Pairing", start: "10:00", end: "11:00", color: "amber" }),
      seed({
        title: "Gym",
        date: "2026-10-05",
        start: "07:00",
        end: "08:00",
        color: "green",
        repeat: "daily",
      }),
      seed({ title: "Release", date: "2026-10-09", start: "14:00", end: "16:00", color: "red" }),
    ],
    null,
  );
  for (const scale of capture ? [1, 1.5] : [1]) {
    setUiScaleFactor(scale);
    for (const [width, height] of [
      [1020, 760],
      [640, 650],
    ]) {
      const shot = await mountWindow(
        (size) => (
          <WidgetThemeProvider theme={theme}>
            <CalendarApp
              {...size}
              store={store}
              now={() => NOW}
              viewPreference={{ initial: "week", save: () => null }}
            />
          </WidgetThemeProvider>
        ),
        { width: width * scale, height: height * scale },
      );
      await shot.settle();
      if (capture) shot.screenshot(path.join(capture, `week-${width}x${height}-scale${scale}.png`));
      shot.destroy();
    }
  }
  setUiScaleFactor(1);

  const w = await mountWindow(
    (size) => (
      <WidgetThemeProvider theme={theme}>
        <CalendarApp
          {...size}
          store={store}
          now={() => NOW}
          viewPreference={{ initial: loadViewMode(), save: saveViewMode }}
        />
      </WidgetThemeProvider>
    ),
    { width: 1020, height: 900 },
  );
  const ctrl = (key: keyof typeof KEY) => w.key(KEY[key], key, { ctrl: true });
  const alt = (key: "ArrowLeft" | "ArrowRight") => w.key(ARROW[key], key, { alt: true });
  try {
    assert.ok(w.texts().includes("October 2026"), "opens on the month, as no view was chosen yet");

    // A coloured event that repeats weekly three times, made entirely in the editor.
    ctrl("n");
    w.type("Swim");
    w.press({ focusId: "calendar:color:teal" });
    assert.ok(w.texts().includes("Colour · Teal"));
    w.press({ text: "Weekly" });
    assert.ok(w.texts().includes("Repeat every … weeks"), "repeat details appear once chosen");
    w.press({ text: "After" });
    w.press({ focusId: "calendar:field:count" });
    if (capture) w.screenshot(path.join(capture, "editor-repeat.png"));
    ctrl("a");
    w.type("3");
    ctrl("s");
    const swim = store.read().find((event) => event.title === "Swim");
    assert.ok(swim, "the event is saved");
    assert.equal(swim.color, "teal");
    assert.deepEqual(swim.repeat, {
      frequency: "weekly",
      interval: 1,
      end: { kind: "count", count: 3 },
    });

    // Week view by shortcut, remembered for next time.
    ctrl("2");
    assert.equal(loadViewMode(), "week", "the chosen view is saved as a preference");
    assert.ok(w.texts().includes("5 – 11 October 2026"));
    // Blocks are found by occurrence (event id and repeat number); narrow ones ellipsize titles.
    const shown = (key: string) => {
      try {
        windowControl(w.window, { focusId: `occurrence:${key}` });
        return true;
      } catch {
        return false;
      }
    };
    for (const event of store.read().filter((item) => !item.repeat))
      assert.ok(shown(event.id), `${event.title} is laid out in the week`);
    assert.ok(shown(`${swim.id}#0`));
    assert.equal(
      w.texts().filter((text) => text === "Gym").length,
      7,
      "a daily repeat fills the week",
    );
    // Alt+Right pages forward; the weekly repeat shows twice more, then stops.
    alt("ArrowRight");
    assert.ok(w.texts().includes("12 – 18 October 2026"));
    assert.ok(shown(`${swim.id}#1`));
    assert.equal(w.texts().filter((text) => text === "Gym").length, 7);
    alt("ArrowRight");
    assert.ok(shown(`${swim.id}#2`));
    w.press({ focusId: "calendar:next" });
    assert.ok(!shown(`${swim.id}#3`), "the repeat ends after three times");
    w.press({ focusId: "calendar:previous" });
    assert.ok(w.texts().includes("19 – 25 October 2026"));
    // Opening a repeat edits its series.
    w.press({ focusId: `occurrence:${swim.id}#2` });
    assert.ok(w.texts().includes("Edit event"));
    assert.ok(w.texts().includes("Colour · Teal"));
    w.key(1, "Escape");
    ctrl("t");
    assert.ok(w.texts().includes("5 – 11 October 2026"), "Ctrl+T returns to today");
    w.press({ text: "Month" });
    assert.ok(w.texts().includes("October 2026"));
    assert.equal(loadViewMode(), "month");

    // Import through the shared chooser: Ctrl+O, arrow to the file, Enter.
    const documents = path.join(home, "Documents");
    await fs.mkdir(documents, { recursive: true });
    await fs.writeFile(path.join(documents, "broken.ics"), "not a calendar");
    await fs.writeFile(
      path.join(documents, "team.ics"),
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:offsite",
        "SUMMARY:Team offsite",
        "DTSTART;TZID=Europe/Berlin:20261008T090000",
        "DTEND;TZID=Europe/Berlin:20261008T120000",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:retro",
        "SUMMARY:Retro",
        "DTSTART:20261007T150000Z",
        "DTEND:20261007T160000Z",
        "RRULE:FREQ=WEEKLY;BYDAY=WE,FR",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    ctrl("o");
    assert.ok(w.texts().includes("Import calendar"), "Ctrl+O opens the file chooser");
    assert.ok(w.texts().includes("team.ics") && w.texts().includes("broken.ics"));
    w.key(ARROW.ArrowDown, "ArrowDown");
    w.key(ARROW.ArrowDown, "ArrowDown");
    w.key(28, "Enter");
    await w.until(
      () => store.read().some((event) => event.title === "Retro"),
      "the .ics events are saved",
    );
    assert.ok(store.read().some((event) => event.id === "ics:offsite"));
    assert.deepEqual(loadRecentFiles(APP_ID), [path.join(documents, "team.ics")]);
    await w.until(
      () => w.texts().includes("Imported 2 events"),
      "the simplified repeat is reported",
    );
    assert.ok(w.texts().some((text) => text.includes("BYDAY=WE,FR")));
    w.press({ text: "OK" });
    assert.ok(w.texts().includes("Retro"), "the imported event shows on the selected day");

    // Importing the same file again updates instead of duplicating; a bad file says why.
    const before = store.read().length;
    w.press({ focusId: "calendar:more" });
    w.press({ text: "Import .ics file…" });
    await w.until(() => w.texts().includes("Import calendar"), "the menu opens the chooser");
    w.key(ARROW.ArrowDown, "ArrowDown");
    w.key(28, "Enter");
    await w.until(() => w.texts().includes("Could not import"), "an unreadable file is reported");
    assert.ok(w.texts().some((text) => text.includes("not an iCalendar")));
    assert.equal(store.read().length, before, "a failed import changes nothing");
    w.press({ text: "OK" });
    ctrl("o");
    w.key(ARROW.ArrowDown, "ArrowDown");
    w.key(ARROW.ArrowDown, "ArrowDown");
    w.key(28, "Enter");
    await w.until(
      () => w.texts().some((text) => text.includes("updated 2 events")),
      "re-import reports updates",
    );
    assert.equal(store.read().length, before, "a re-import replaces the events it imported before");
  } finally {
    w.destroy();
  }
});
console.log(
  "[calendar/workflow] editor colour + repeat, week view navigation and preference, .ics import passed",
);
