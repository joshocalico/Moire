import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { DictionaryService, parseDefinitions } from "./dictionary";
import { DictionaryApp } from "./main";
import { harness } from "./testing";
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-dictionary-smoke-"));
const response = [
  {
    word: "hello",
    phonetic: "həˈləʊ",
    meanings: [
      {
        partOfSpeech: "exclamation",
        definitions: [{ definition: "A greeting.", example: "Hello there." }],
      },
    ],
  },
];
let requests = 0;
const fetcher: typeof fetch = async () => {
  requests++;
  return new Response(JSON.stringify(response), { status: 200 });
};
try {
  const service = new DictionaryService(fixture, fetcher);
  assert.equal((await service.lookup("hello")).source, "online");
  const offline = new DictionaryService(fixture, async () => {
    throw new Error("offline");
  });
  assert.equal((await offline.lookup("hello")).source, "cache");
  await assert.rejects(() => offline.lookup("unknown"), /unavailable/);
  assert.throws(() => parseDefinitions({}));
  const missing = new DictionaryService(
    path.join(fixture, "empty"),
    async () => new Response("{}", { status: 404 }),
  );
  await assert.rejects(() => missing.lookup("missing"), /No definition/);
  const app = await harness((size) => <DictionaryApp {...size} service={service} />, 700, 650);
  app.text("hello");
  app.key(28, "Enter");
  await app.settle();
  assert.equal(requests, 1, "cached lookup made an unnecessary network request");
  assert.ok(app.native.lastFrame);
  app.destroy();
  console.log("Dictionary schema/offline cache/error states and actual Window lookup passed");
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}
