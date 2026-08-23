import assert from "node:assert/strict";
import { TerminalBuffer } from "./model.js";

const terminal = new TerminalBuffer(12, 3, 20);
terminal.write("hello\r\n\x1b[31mred\x1b[0m");
let snapshot = terminal.snapshot();
assert.equal(snapshot.lines[0]?.map((cell) => cell.char).join(""), "hello");
assert.equal(snapshot.lines[1]?.map((cell) => cell.char).join(""), "red");
assert.equal(snapshot.lines[1]?.[0]?.foreground, 0xffd35f5f);

terminal.write("\r\nthree\r\nfour");
snapshot = terminal.snapshot();
assert.ok(snapshot.lines.length > snapshot.rows, "scrollback was not retained");
assert.equal(snapshot.cursorLine, snapshot.lines.length - 1);

terminal.write("\x1b[2J\x1b[Hfresh");
snapshot = terminal.snapshot();
assert.equal(snapshot.lines.at(-3)?.map((cell) => cell.char).join(""), "fresh");

terminal.write("\x1b]2;Moire shell\u0007");
assert.equal(terminal.snapshot().title, "Moire shell");

terminal.write("\x1b[6n");
assert.match(terminal.drainResponses()[0] ?? "", /^\x1b\[\d+;\d+R$/);

terminal.resize(20, 5);
assert.equal(terminal.snapshot().columns, 20);
assert.equal(terminal.snapshot().rows, 5);

console.log("[terminal/smoke] ok");
