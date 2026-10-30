/**
 * FileChooser portal: what a request asks the chooser to show, the results a choice becomes, and
 * the request lifecycle over D-Bus. Picking a file by hand is a VM check (docs/portals.md).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { variant, type DbusVariant } from "@moire/dbus";
import {
  chooserRequest,
  chooserResults,
  filterExtensions,
  type PortalFilter,
} from "./file-chooser-model";
import { startPortalFixture } from "./testing";

const FILE_CHOOSER = "org.freedesktop.impl.portal.FileChooser";
const bytes = (text: string) => variant("ay", Buffer.from(`${text}\0`));
const mime = (type: string) =>
  type === "image/png" ? ["png"] : type === "image/*" ? ["png", "jpg", "webp"] : [];
const images: PortalFilter = [
  "Images",
  [
    [0, "*.[pP][nN][gG]"],
    [0, "*.jpg"],
  ],
];
const archives: PortalFilter = [
  "Archives",
  [
    [0, "*.tar.gz"],
    [1, "image/png"],
  ],
];
const anything: PortalFilter = ["All files", [[0, "*"]]];

// Filters.
assert.deepEqual(filterExtensions(images, mime), ["png", "jpg"]);
assert.deepEqual(filterExtensions(archives, mime), ["gz", "png"]);
assert.equal(filterExtensions(anything, mime), null);
assert.equal(filterExtensions(["Odd", [[1, "application/x-unknown"]]], mime), null);
assert.deepEqual(filterExtensions(["Pictures", [[1, "image/*"]]], mime), ["png", "jpg", "webp"]);

// OpenFile.
{
  const request = chooserRequest(
    "open",
    "org.example.Paint",
    "Import",
    {
      multiple: variant("b", true),
      filters: variant("a(sa(us))", [images, archives]),
      current_filter: variant("(sa(us))", archives),
      current_folder: bytes("/home/ada/Pictures"),
      choices: variant("a(ssa(ss)s)", [["encoding", "Encoding", [["utf8", "UTF-8"]], "utf8"]]),
    },
    mime,
  );
  assert.equal(request.mode, "open");
  assert.equal(request.multiple, true);
  assert.equal(request.title, "Import");
  assert.equal(request.chooserId, "portal.org.example.Paint");
  assert.equal(request.directory, "/home/ada/Pictures");
  assert.deepEqual(request.accept?.sort(), ["gz", "jpg", "png"]);
  const results = chooserResults(request, ["/home/ada/Pictures/a b.png", "/tmp/c.jpg"], mime);
  assert.deepEqual(results.uris, {
    signature: "as",
    value: ["file:///home/ada/Pictures/a%20b.png", "file:///tmp/c.jpg"],
  });
  assert.deepEqual(results.choices, { signature: "a(ss)", value: [["encoding", "utf8"]] });
  assert.deepEqual(results.current_filter?.value, archives, "several files keep the given filter");
  assert.equal(results.writable, undefined);
  const one = chooserResults(request, ["/tmp/c.jpg"], mime);
  assert.deepEqual(one.current_filter?.value, images, "one file reports the filter it matches");
}
// One filter that admits everything means no filtering; `directory` picks folders.
{
  const open = chooserRequest(
    "open",
    "",
    "",
    { filters: variant("a(sa(us))", [images, anything]), multiple: variant("s", "yes") },
    mime,
  );
  assert.equal(open.accept, undefined);
  assert.equal(open.multiple, false, "a wrongly typed option is ignored");
  assert.equal(open.title, "Open");
  assert.equal(open.chooserId, "org.moire.Portal");
  const folder = chooserRequest(
    "open",
    "a/../b",
    "",
    { directory: variant("b", true), multiple: variant("b", true) },
    mime,
  );
  assert.equal(folder.mode, "folder");
  assert.equal(folder.multiple, false);
  assert.equal(folder.chooserId, "portal.a_.._b");
  assert.equal(folder.directory, undefined);
}
// SaveFile: name and folder from the app, never a path that climbs out.
{
  const named = chooserRequest(
    "save",
    "org.example.Paint",
    "",
    {
      current_name: variant("s", "../../etc/passwd"),
      current_folder: bytes("relative/folder"),
    },
    mime,
  );
  assert.equal(named.mode, "save");
  assert.equal(named.name, "passwd");
  assert.equal(named.directory, undefined, "a relative folder is not honoured");
  const existing = chooserRequest(
    "save",
    "org.example.Paint",
    "",
    { current_file: bytes("/home/ada/Documents/draft.txt") },
    mime,
  );
  assert.equal(existing.directory, "/home/ada/Documents");
  assert.equal(existing.name, "draft.txt");
  const results: Record<string, DbusVariant> = chooserResults(existing, ["/home/ada/x.txt"], mime);
  assert.deepEqual(results.uris?.value, ["file:///home/ada/x.txt"]);
  assert.deepEqual(results.writable, { signature: "b", value: true });
}
// SaveFiles: a folder, with each offered name placed inside it.
{
  const request = chooserRequest(
    "save-files",
    "org.example.Paint",
    "Export",
    {
      files: variant("aay", [
        Buffer.from("one.png\0"),
        Buffer.from("../two.png\0"),
        Buffer.from("..\0"),
      ]),
    },
    mime,
  );
  assert.equal(request.mode, "folder");
  assert.deepEqual(request.files, ["one.png", "two.png"]);
  assert.deepEqual(chooserResults(request, ["/home/ada/Out"], mime).uris?.value, [
    "file:///home/ada/Out/one.png",
    "file:///home/ada/Out/two.png",
  ]);
}

// Over D-Bus: a chooser opens for each method and its Request ends it.
const fixture = await startPortalFixture("file-chooser");
try {
  const pictures = path.join(fixture.home, "Pictures");
  fs.mkdirSync(pictures);
  fs.writeFileSync(path.join(pictures, "photo.png"), "");
  await fixture.start();
  const stranger = await fixture.connect();
  const options: Record<string, Record<string, DbusVariant>> = {
    OpenFile: {
      multiple: variant("b", true),
      filters: variant("a(sa(us))", [images]),
      current_folder: bytes(pictures),
    },
    SaveFile: { current_name: variant("s", "untitled.png"), current_folder: bytes(pictures) },
    SaveFiles: { files: variant("aay", [Buffer.from("a.png\0")]) },
  };
  for (const member of ["OpenFile", "SaveFile", "SaveFiles"]) {
    const handle = fixture.requestHandle(member);
    const body = (to: string) => [
      to,
      "org.example.Paint",
      "wayland:parent",
      member,
      options[member],
    ];
    const pending = fixture.call(FILE_CHOOSER, member, "osssa{sv}", body(handle));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const busy = await fixture.call(
      FILE_CHOOSER,
      member,
      "osssa{sv}",
      body(fixture.requestHandle(`${member}_second`)),
    );
    assert.deepEqual(busy.body, [2, {}], "one dialog at a time");
    await assert.rejects(fixture.closeRequest(handle, stranger), /AccessDenied/);
    await fixture.closeRequest(handle);
    const reply = await pending;
    assert.equal(reply.signature, "ua{sv}");
    assert.deepEqual(reply.body, [2, {}], `${member}: Close ends the chooser`);
    await assert.rejects(
      fixture.call(FILE_CHOOSER, member, "osssa{sv}", body(fixture.requestHandle("x")), stranger),
      /AccessDenied/,
    );
  }
  console.log("[portal/file-chooser] ok");
} finally {
  await fixture.close();
}
