/**
 * The audio preview's player hook in a mounted window, against a fake mpv: play/pause, a seek
 * before anything plays (opens paused at that point), a seek while playing, and that changing the
 * previewed file closes the session.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import React, { useState } from "react";
import { TextBlock } from "@moire/ui";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import { useAudioPlayback, type AudioPlayback } from "./use-audio-playback";

/** An mpv stand-in on the IPC socket: loads at once, keeps pause and position, logs its life. */
const FAKE_MPV = String.raw`#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs';
const args=process.argv.slice(2);
const endpoint=args.find(value=>value.startsWith('--input-ipc-server=')).split('=').slice(1).join('=');
const log=args.find(value=>value.startsWith('--log=')).slice('--log='.length);
const note=line=>fs.appendFileSync(log,line+'\n');
let pause=true,position=0;
process.on('SIGTERM',()=>{note('closed');process.exit(0);});
net.createServer(socket=>{
  let input='';
  socket.on('data',chunk=>{
    input+=String(chunk);
    for(let newline=input.indexOf('\n');newline>=0;newline=input.indexOf('\n')){
      const request=JSON.parse(input.slice(0,newline));input=input.slice(newline+1);
      const send=value=>socket.write(JSON.stringify(value)+'\n');
      const reply=data=>send({request_id:request.request_id,error:'success',data});
      const [name,...rest]=request.command;
      if(name==='loadfile'){note('load '+rest[0]);reply();send({event:'file-loaded'});send({event:'playback-restart'});}
      else if(name==='seek'){position=rest[0];reply();}
      else if(name==='set_property'&&rest[0]==='pause'){pause=rest[1];reply();}
      else if(name==='get_property')reply({pause,duration:3,'time-pos':position,volume:100}[rest[0]]);
      else reply();
    }
  });
}).listen(endpoint);
`;

await withFixture(async (directory) => {
  const binary = path.join(directory, "mpv-fixture");
  await fs.writeFile(binary, FAKE_MPV, { mode: 0o700 });
  const log = path.join(directory, "mpv.log");
  const first = path.join(directory, "first.wav");
  const second = path.join(directory, "second.wav");
  await fs.writeFile(first, "fixture audio");
  await fs.writeFile(second, "more fixture audio");
  const lines = async () => (await fs.readFile(log, "utf8").catch(() => "")).trim().split("\n");

  let playback: AudioPlayback | null = null;
  let choose: (file: string | null) => void = () => {};
  function Player() {
    const [file, setFile] = useState<string | null>(first);
    choose = setFile;
    playback = useAudioPlayback(file, { binary, extraArgs: [`--log=${log}`] });
    return <TextBlock text={`${playback.state.kind} ${playback.position}`} />;
  }
  const mounted = await mountWindow(() => <Player />, { width: 320, height: 120 });
  const current = () => playback!;
  try {
    assert.equal(current().state.kind, "idle");
    assert.equal(current().playing, false);
    assert.equal(current().position, 0);

    // Seeking first opens the file paused at that point.
    current().seek(1.5);
    await mounted.until(() => current().position === 1.5, "a first seek opens at 1.5 s");
    assert.equal(current().playing, false, "a first seek does not start playing");
    assert.equal(current().duration, 3);
    assert.deepEqual(await lines(), [`load ${first}`]);

    // Toggle plays and pauses the same session.
    current().toggle();
    await mounted.until(() => current().playing, "toggle plays");
    current().seek(0.5);
    await mounted.until(() => current().position === 0.5, "a seek while playing moves");
    assert.equal(current().playing, true, "seeking keeps playing");
    current().toggle();
    await mounted.until(() => !current().playing, "toggle pauses");

    // A different file closes the session; the next press opens the new file.
    choose(second);
    await mounted.until(() => current().state.kind === "idle", "a new file resets the player");
    await mounted.until(() => current().position === 0, "position resets");
    const deadline = Date.now() + 3000;
    while (!(await lines()).includes("closed") && Date.now() < deadline) await mounted.settle(1);
    assert.ok((await lines()).includes("closed"), "the old mpv is stopped");
    current().toggle();
    await mounted.until(() => current().playing, "the new file plays");
    assert.equal((await lines()).at(-1), `load ${second}`);
    choose(null);
    await mounted.until(() => current().state.kind === "idle", "no file, no player");
  } finally {
    mounted.destroy();
  }
});
console.log("[files/audio-playback] seek-to-open, toggle, seek while playing, file change ok");
