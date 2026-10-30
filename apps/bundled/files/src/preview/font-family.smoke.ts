/** A font's sibling faces are found beside it, with their weights, and stay bounded. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fontFamilyFaces, fontWeightOf } from "./font-family";

assert.equal(fontWeightOf("Regular"), 400);
assert.equal(fontWeightOf("Thin"), 100);
assert.equal(fontWeightOf("ExtraLight Italic"), 200);
assert.equal(fontWeightOf("Light"), 300);
assert.equal(fontWeightOf("Medium"), 500);
assert.equal(fontWeightOf("Semi Bold"), 600);
assert.equal(fontWeightOf("Bold Italic"), 700);
assert.equal(fontWeightOf("Extra-Bold"), 800);
assert.equal(fontWeightOf("Black"), 900);
assert.equal(fontWeightOf("Italic"), 400);

const fonts = fileURLToPath(new URL("../../../../../packages/ui/fonts/", import.meta.url));
const root = await fs.mkdtemp(path.join(os.tmpdir(), "moire-font-family-"));
// No installed fonts interfere: the XDG data folder is empty for this run.
process.env.XDG_DATA_HOME = path.join(root, "data");
try {
  const folder = path.join(root, "Plex");
  await fs.mkdir(path.join(folder, "static"), { recursive: true });
  for (const style of ["Regular", "Medium"])
    await fs.copyFile(
      path.join(fonts, `IBMPlexSans-${style}.ttf`),
      path.join(folder, `IBMPlexSans-${style}.ttf`),
    );
  // Faces one folder down are found too; another family is not.
  await fs.copyFile(
    path.join(fonts, "IBMPlexSans-Bold.ttf"),
    path.join(folder, "static", "IBMPlexSans-Bold.ttf"),
  );
  await fs.copyFile(path.join(fonts, "IBMPlexMono-Regular.ttf"), path.join(folder, "Mono.ttf"));
  // A duplicate style is listed once, and a broken file is skipped.
  await fs.copyFile(
    path.join(fonts, "IBMPlexSans-Medium.ttf"),
    path.join(folder, "Copy of Medium.ttf"),
  );
  await fs.writeFile(path.join(folder, "broken.ttf"), "not a font");

  const regular = path.join(folder, "IBMPlexSans-Regular.ttf");
  const faces = await fontFamilyFaces(regular);
  assert.deepEqual(
    faces.map((face) => [face.style, face.weight, face.family]),
    [
      ["Regular", 400, "IBM Plex Sans"],
      ["Medium", 500, "IBM Plex Sans"],
      ["Bold", 700, "IBM Plex Sans"],
    ],
  );
  assert.equal(faces[0]!.path, regular, "the file itself is always its own style's face");
  assert.equal(faces[2]!.path, path.join(folder, "static", "IBMPlexSans-Bold.ttf"));

  const unreadable = await fontFamilyFaces(path.join(folder, "broken.ttf"));
  assert.equal(unreadable.length, 1, "an unreadable file is listed alone");

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fontFamilyFaces(regular, controller.signal));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log("font family smoke passed");
