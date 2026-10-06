import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PlaybackSession, type PlaybackState } from "./playback";
import { withFixture } from "./testing";

await withFixture(async (directory) => {
  const file = path.join(directory, "media.wav");
  await fs.writeFile(file, "Disposable IPC lifecycle fixture");
  const binary = path.join(directory, "mpv-fixture");
  await fs.writeFile(
    binary,
    String.raw`#!/usr/bin/env node
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2);
const endpoint=args.find(value=>value.startsWith('--input-ipc-server=')).split('=').slice(1).join('=');
const mode=args.find(value=>value.startsWith('--fixture=')).slice('--fixture='.length);
const marker=path.join(path.dirname(fileURLToPath(import.meta.url)),mode+'.json');
let loaded=false,restarted=false;
net.createServer(socket=>{
  let input='';
  socket.on('data',chunk=>{
    input+=String(chunk);
    for(let newline=input.indexOf('\n');newline>=0;newline=input.indexOf('\n')){
      const request=JSON.parse(input.slice(0,newline));input=input.slice(newline+1);
      const send=value=>socket.write(JSON.stringify(value)+'\n');
      const reply=data=>send({request_id:request.request_id,error:'success',data});
      const command=request.command;
      if(command[0]==='loadfile'){
        fs.writeFileSync(marker,JSON.stringify({args,file:command[1]}));
        reply();
        if(mode==='error')send({event:'end-file',reason:'error',file_error:'Fixture decode failure'});
        if(mode==='disconnect')socket.end();
        if(mode==='exit')process.exit(0);
      }else if(command[0]==='fixture'){
        reply();
        if(command[1]==='loaded'){loaded=true;send({event:'file-loaded'});}
        if(command[1]==='restart'){restarted=true;send({event:'playback-restart'});}
        if(command[1]==='eof')send({event:'end-file',reason:'eof'});
      }else if(command[0]==='get_property'){
        if(!loaded||!restarted)send({request_id:request.request_id,error:'property unavailable'});
        else reply({'pause':true,'duration':3,'time-pos':0,'volume':100}[command[1]]);
      }
    }
  });
}).listen(endpoint);
`,
    { mode: 0o700 },
  );
  const waitForLoad = async (mode: string) => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      try {
        return JSON.parse(
          await fs.readFile(path.join(directory, `${mode}.json`), "utf8"),
        ) as unknown;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error(`The ${mode} fixture did not receive loadfile.`);
  };
  const states: PlaybackState[] = [];
  const session = new PlaybackSession((state) => states.push(state), {
    binary,
    video: true,
    extraArgs: ["--fixture=delayed"],
  });
  let resolved = false;
  const opening = session.open(file).then(() => {
    resolved = true;
  });
  try {
    const request = await waitForLoad("delayed");
    assert.ok(
      request &&
        typeof request === "object" &&
        "args" in request &&
        Array.isArray(request.args) &&
        "file" in request,
    );
    assert.equal(request.file, file);
    assert.equal(
      request.args.includes(file),
      false,
      "file load begins only after IPC handlers exist",
    );
    assert.equal(request.args.includes("--no-video"), false, "video decoding is enabled");
    assert.equal(resolved, false, "loadfile acknowledgement does not complete open");
    assert.equal(states.at(-1)?.kind, "opening");
    await session.command(["fixture", "loaded"]);
    assert.equal(resolved, false, "header load alone does not complete initial decoding");
    assert.equal(states.at(-1)?.kind, "opening");
    await session.command(["fixture", "restart"]);
    await opening;
    const state = states.at(-1);
    assert.ok(state?.kind === "ready");
    assert.equal(state.duration, 3);
    assert.equal(await session.command(["get_property", "duration"]), 3);
    await session.command(["fixture", "eof"]);
    const eofDeadline = Date.now() + 5_000;
    while (states.at(-1)?.kind !== "idle" && Date.now() < eofDeadline)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(states.at(-1)?.kind, "idle", "end of file releases ready controls");
  } finally {
    await session.close();
    await opening;
  }
  for (const mode of ["error", "disconnect", "exit", "cancel"]) {
    const changes: PlaybackState[] = [];
    const playback = new PlaybackSession((state) => changes.push(state), {
      binary,
      extraArgs: [`--fixture=${mode}`],
    });
    const open = playback.open(file);
    try {
      await waitForLoad(mode);
      if (mode === "cancel") await playback.close();
      await open;
      assert.equal(
        changes.some((state) => state.kind === "ready"),
        false,
        `${mode} cannot expose ready controls`,
      );
      if (mode !== "cancel") {
        const state = changes.at(-1);
        assert.ok(state?.kind === "error");
        if (mode === "error")
          assert.equal(
            state.message,
            "Fixture decode failure",
            "cleanup preserves the real load error",
          );
      }
    } finally {
      await playback.close();
      await open;
    }
  }
  assert.deepEqual(
    await fs.readdir(path.join(directory, "tmp")),
    [],
    "all private playback sockets are removed",
  );
});
console.log(
  "[app-tools/playback] actual IPC startup/load/restart ordering, EOF, decode error, disconnect, backend exit and close during opening passed",
);
