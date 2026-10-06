import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { HELP_TOPICS, searchHelp } from "./catalog";
import { HelpApp } from "./main";
import { harness } from "./testing";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
for (const topic of HELP_TOPICS)
  assert.ok(fs.existsSync(path.join(root, topic.source)), `help source missing: ${topic.source}`);
assert.ok(searchHelp("Ctrl+Shift+S").some((topic) => topic.id === "editor"));
assert.ok(searchHelp("hidden files").some((topic) => topic.id === "files-navigation"));
for (const [name, id] of [
  ["Text Editor", "editor"],
  ["Image Viewer", "image-viewer"],
  ["Calculator", "calculator"],
  ["Notes", "notes"],
  ["Music", "music"],
  ["Archive Manager", "archive-manager"],
  ["System Monitor", "system-monitor"],
  ["Calendar", "calendar"],
  ["Clock", "clock"],
  ["Screenshot", "screenshot"],
  ["Document Viewer", "document-viewer"],
  ["Video Player", "video-player"],
  ["Disk Usage", "disk-usage"],
  ["Font Viewer", "font-viewer"],
  ["Characters", "characters"],
  ["Colors", "colors"],
  ["Sound Recorder", "sound-recorder"],
  ["Weather", "weather"],
  ["Dictionary", "dictionary"],
  ["Help", "help"],
])
  assert.ok(
    searchHelp(name).some((topic) => topic.id === id),
    `No searchable help for ${name}`,
  );
assert.equal(new Set(HELP_TOPICS.map((topic) => topic.id)).size, HELP_TOPICS.length);
assert.equal(searchHelp("zzzz-no-match").length, 0);
const app = await harness((size) => <HelpApp {...size} />, 820, 660);
app.text("Ctrl+Shift+S");
assert.ok(app.native.lastFrame);
app.destroy();
console.log("Help source references/search and actual Window search passed");
