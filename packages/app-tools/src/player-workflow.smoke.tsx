/** Public Window input plus actual PlaybackSession/Unix IPC. The child is a protocol fixture, not audible/video mpv acceptance. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import React from "react";
import { Window, installUiFonts } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { loadRecentFiles } from "./frame";
import { mountWindow, windowControl, withFixture } from "./testing";
import { PlayerApp } from "./player";

await installUiFonts();
const previousPath = process.env.PATH;
await withFixture(async (directory) => {
  const first = path.join(directory, "first.mp4"),
    second = path.join(directory, "second.mp4"),
    binary = path.join(directory, "mpv-fixture.mjs"),
    journal = path.join(directory, "journal.ndjson");
  await fs.writeFile(first, "Disposable first IPC fixture");
  await fs.writeFile(second, "Disposable second IPC fixture");
  await fs.writeFile(
    binary,
    String.raw`#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs';
const endpoint=process.argv.find(a=>a.startsWith('--input-ipc-server=')).slice('--input-ipc-server='.length);
const journal=process.argv.find(a=>a.startsWith('--journal='))?.slice('--journal='.length) ?? new URL('journal.ndjson',import.meta.url).pathname;
const record=value=>fs.appendFileSync(journal,JSON.stringify({pid:process.pid,endpoint,...value})+'\n');
let paused=true,position=0;
const clients=new Set();
net.createServer(socket=>{
 clients.add(socket);socket.on('close',()=>clients.delete(socket));
 socket.on('error',error=>{
  if(error.code==='ECONNRESET'||error.code==='EPIPE'){record({kind:'peer-disconnected',code:error.code});return;}
  throw error;
 });let input='';
 socket.on('data',chunk=>{input+=String(chunk);for(let n=input.indexOf('\n');n>=0;n=input.indexOf('\n')){
  const request=JSON.parse(input.slice(0,n));input=input.slice(n+1);const command=request.command;
  const send=value=>socket.write(JSON.stringify(value)+'\n');const reply=data=>send({request_id:request.request_id,error:'success',data});
  if(command[0]==='fixture'){
   for(const client of clients) if(client!==socket) {
    const count=command[1]==='eof-twice'?2:1;
    for(let index=0;index<count;index++) client.write(JSON.stringify({event:'end-file',reason:command[1]==='eof-twice'?'eof':command[1]})+'\n');
   }
   record({kind:'event',reason:command[1]});socket.end();continue;
  }
  record({kind:'command',command});
  if(command[0]==='loadfile'){reply();send({event:'file-loaded'});send({event:'playback-restart'});}
  else if(command[0]==='get_property')reply({'pause':paused,'time-pos':position,'duration':3,'volume':100}[command[1]]);
  else {if(command[0]==='set_property'&&command[1]==='pause')paused=command[2];if(command[0]==='cycle'&&command[1]==='pause')paused=!paused;if(command[0]==='seek')position=command[1];reply();}
 }});
}).listen(endpoint);
process.on('SIGTERM',()=>{record({kind:'closed'});process.exit(0);});
`,
    { mode: 0o700 },
  );
  const fixtureBin = path.join(directory, "bin");
  await fs.mkdir(fixtureBin);
  await fs.symlink(binary, path.join(fixtureBin, "mpv"));
  process.env.PATH = fixtureBin + path.delimiter + (previousPath ?? "");
  type Record = {
    pid: number;
    endpoint: string;
    kind: string;
    command?: unknown[];
    reason?: string;
  };
  const records = async (): Promise<Record[]> => {
    try {
      return (await fs.readFile(journal, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
      throw error;
    }
  };
  const processExited = (pid: number): boolean => {
    assert.ok(Number.isSafeInteger(pid) && pid > 0, "only recorded fixture PIDs are observed");
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ESRCH") return true;
      throw error;
    }
  };
  assert.equal(
    processExited(process.pid),
    false,
    "live-process negative control cannot claim exit",
  );
  const loads = async () =>
    (await records()).filter((row) => row.kind === "command" && row.command?.[0] === "loadfile");
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Video queue workflow", width: 860, height: 620 });
  window.setContent((size) => (
    <PlayerApp
      {...size}
      video
      initialPaths={[first, second, second]}
      playbackOptions={{ binary, extraArgs: [`--journal=${journal}`] }}
    />
  ));
  let scheduled = false;
  const stopWake = window.onInvalidated(() => {
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (!window.isClosed()) window.tick();
      });
    }
  });
  window.mount(backend);
  window.tick();
  const native = backend.getWindows()[0];
  assert.ok(native);
  const wait = async (predicate: () => Promise<boolean>, label: string) => {
    const deadline = performance.now() + 5000;
    while (performance.now() < deadline) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out: ${label}`);
  };
  const click = (focusId: string) => {
    window.tick();
    const { x, y } = windowControl(window, { focusId });
    native.injectPointer({ type: "down", button: "left", x, y, timeMs: 1 });
    native.injectPointer({ type: "up", button: "left", x, y, timeMs: 2 });
  };
  const eof = async (endpoint: string, reason = "eof") => {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(endpoint);
      socket.once("error", reject);
      socket.once("connect", () =>
        socket.end(JSON.stringify({ command: ["fixture", reason] }) + "\n"),
      );
      socket.once("close", () => resolve());
    });
  };
  try {
    await wait(
      async () => (await records()).some((row) => row.command?.[0] === "get_property"),
      "initial loaded ready state",
    );
    assert.equal((await loads())[0]?.command?.[1], first);
    assert.ok(native.lastFrame?.length === 860 * 620 * 4);
    const firstPixels = Buffer.from(native.lastFrame);
    const initial = (await loads())[0];
    assert.ok(initial);
    await eof(initial.endpoint, "eof-twice");
    await wait(async () => (await loads()).length === 2, "EOF advances first item");
    await wait(async () => {
      const middle = (await loads())[1];
      return (await records()).some(
        (row) =>
          row.pid === middle?.pid &&
          row.command?.[0] === "set_property" &&
          row.command?.[1] === "pause" &&
          row.command?.[2] === false,
      );
    }, "automatic continuation actually plays next item");
    assert.equal((await loads())[1]?.command?.[1], second);
    assert.ok(
      native.lastFrame && !Buffer.from(native.lastFrame).equals(firstPixels),
      "new queue item paints a different actual frame",
    );
    const middle = (await loads())[1];
    assert.ok(middle);
    await eof(middle.endpoint);
    await wait(
      async () => (await loads()).length === 3,
      "adjacent identical path gets a fresh queue session",
    );
    const final = (await loads())[2];
    assert.ok(final);
    assert.equal(final.command?.[1], second);
    assert.notEqual(final.pid, middle.pid);
    await wait(
      async () =>
        (await records()).some(
          (row) =>
            row.pid === final.pid &&
            row.command?.[0] === "set_property" &&
            row.command?.[2] === false,
        ),
      "last item starts playing",
    );
    await eof(final.endpoint);
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal((await loads()).length, 3, "terminal EOF does not reopen or wrap the playlist");
    click("playback:pause");
    await wait(async () => (await loads()).length === 4, "Play replays the finished last item");
    const replay = (await loads())[3];
    assert.ok(replay);
    await wait(
      async () =>
        (await records()).some(
          (row) =>
            row.pid === replay.pid &&
            row.command?.[0] === "set_property" &&
            row.command?.[2] === false,
        ),
      "replay actually resumes playback",
    );
    click("playback:stop");
    await wait(
      async () => (await records()).some((row) => row.pid === replay.pid && row.kind === "closed"),
      "Stop closes the actual backend",
    );
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal((await loads()).length, 4, "Stop does not advance the queue");
    click("player:reopen");
    await wait(async () => (await loads()).length === 5, "Reopen starts the selected item paused");
    const reopened = (await loads())[4];
    assert.ok(reopened);
    await wait(
      async () =>
        (await records()).filter(
          (row) => row.pid === reopened.pid && row.command?.[0] === "get_property",
        ).length >= 4,
      "reopened ready state",
    );
    assert.equal(
      (await records()).some(
        (row) =>
          row.pid === reopened.pid &&
          row.command?.[0] === "set_property" &&
          row.command?.[2] === false,
      ),
      false,
    );
    await eof(reopened.endpoint, "error");
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal((await loads()).length, 5, "backend decode errors cannot advance a queue");
  } finally {
    stopWake();
    window.destroy();
    backend.disconnect();
    await wait(async () => {
      const journal = await records();
      return (await loads()).every((load) =>
        journal.some((row) => row.pid === load.pid && row.kind === "closed"),
      );
    }, "all fixture processes acknowledged SIGTERM teardown");
    await wait(
      async () => (await loads()).every((load) => processExited(load.pid)),
      "all fixture processes actually exited after teardown acknowledgement",
    );
  }
  // Building a queue from the file chooser: open one file, add two more, play the third from
  // the list, then clear the rest. Adding and clearing never interrupt what is playing.
  const videos = path.join(directory, "Videos");
  await fs.mkdir(videos);
  for (const name of ["a.mp4", "b.mp4", "c.mp4"]) await fs.writeFile(path.join(videos, name), name);
  await fs.writeFile(path.join(videos, "notes.txt"), "not media");
  const before = (await loads()).length;
  const queued = await mountWindow((size) => (
    <PlayerApp {...size} video playbackOptions={{ binary, extraArgs: [`--journal=${journal}`] }} />
  ));
  const has = (text: string) => queued.texts().includes(text);
  const chooseNth = async (n: number) => {
    await queued.settle();
    assert.ok(!has("notes.txt"), "the chooser offers only media");
    for (let step = 0; step < n; step++) queued.key(108, "ArrowDown");
    queued.key(28, "Enter");
    await queued.settle();
  };
  try {
    queued.press({ text: "Open…" });
    await chooseNth(1);
    await wait(async () => (await loads()).length === before + 1, "Open… plays the chosen file");
    assert.equal((await loads()).at(-1)?.command?.[1], path.join(videos, "a.mp4"));
    queued.press({ focusId: "player:add" });
    await chooseNth(2);
    queued.press({ focusId: "player:add" });
    await chooseNth(3);
    await queued.until(() => has("QUEUE · 3") && has("1 of 3"), "two files were added");
    assert.equal((await loads()).length, before + 1, "adding doesn't restart playback");
    queued.press({ focusId: "player:queue:3" });
    await wait(async () => (await loads()).length === before + 2, "a queued file plays on press");
    const third = (await loads()).at(-1)!;
    assert.equal(third.command?.[1], path.join(videos, "c.mp4"));
    await wait(
      async () =>
        (await records()).some(
          (row) =>
            row.pid === third.pid &&
            row.command?.[0] === "set_property" &&
            row.command?.[2] === false,
        ),
      "the pressed file starts playing",
    );
    queued.press({ focusId: "player:clear-queue" });
    await queued.until(() => !has("QUEUE · 3") && !has("3 of 3"), "Clear empties the queue");
    assert.ok(has("c.mp4"), "the playing file stays");
    await new Promise((resolve) => setTimeout(resolve, 70));
    assert.equal((await loads()).length, before + 2, "clearing doesn't restart playback");
    assert.equal(loadRecentFiles("org.moire.VideoPlayer")[0], path.join(videos, "c.mp4"));
  } finally {
    queued.destroy();
    await wait(
      async () => (await loads()).every((load) => processExited(load.pid)),
      "queue sessions exited on close",
    );
  }
  await wait(
    async () => (await fs.readdir(path.join(directory, "tmp"))).length === 0,
    "private IPC sockets retired",
  );
  assert.deepEqual(
    await fs.readdir(path.join(directory, "tmp")),
    [],
    "private IPC sockets retired",
  );
  console.log(
    "[app-tools/player] public Window EOF/automatic play/duplicate paths/final replay/Stop/Reopen/error/teardown, chooser Open…/Add to queue/play from queue/Clear passed; Unix IPC fixture only, no audible/video qualification",
  );
}).finally(() => {
  if (previousPath === undefined) delete process.env.PATH;
  else process.env.PATH = previousPath;
});
