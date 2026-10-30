import path from "node:path";
import { pathExists } from "./paths";

function splitName(name: string, directory: boolean): { stem: string; extension: string } {
  // A leading dot names a hidden file, not an extension.
  const extension =
    directory || (name.startsWith(".") && name.indexOf(".", 1) < 0) ? "" : path.extname(name);
  return { stem: name.slice(0, name.length - extension.length), extension };
}

/**
 * The first free name in `directory`: `name`, then `name (2)`, `name (3)`…
 * with any extension kept at the end.
 */
export async function uniqueName(
  directory: string,
  desired: string,
  options: { directory?: boolean } = {},
): Promise<string> {
  if (!(await pathExists(path.join(directory, desired)))) return desired;
  const { stem, extension } = splitName(desired, options.directory ?? false);
  for (let suffix = 2; ; suffix++) {
    const candidate = `${stem} (${suffix})${extension}`;
    if (!(await pathExists(path.join(directory, candidate)))) return candidate;
  }
}

/** `report.txt` → `report (copy).txt`, then `report (copy 2).txt`… */
export async function duplicateName(
  directory: string,
  name: string,
  options: { directory?: boolean } = {},
): Promise<string> {
  const { stem, extension } = splitName(name, options.directory ?? false);
  for (let index = 1; ; index++) {
    const candidate = `${stem} (copy${index === 1 ? "" : ` ${index}`})${extension}`;
    if (!(await pathExists(path.join(directory, candidate)))) return candidate;
  }
}

/** `New Folder`, then `New Folder 2`… as desktop environments name new items. */
export async function newItemName(
  directory: string,
  base: string,
  extension = "",
): Promise<string> {
  for (let index = 1; ; index++) {
    const candidate = `${base}${index === 1 ? "" : ` ${index}`}${extension}`;
    if (!(await pathExists(path.join(directory, candidate)))) return candidate;
  }
}
