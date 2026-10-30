/** The permissions model: access levels to and from modes, summaries and account names. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  accessOf,
  accountName,
  currentUserName,
  isExecutable,
  permissionsSummary,
  readAccounts,
  withAccess,
  withExecutable,
  type Access,
  type PermissionClass,
} from "./permissions";

const classes: PermissionClass[] = ["owner", "group", "others"];
const levels: Access[] = ["none", "read", "write"];

// Every class and level round-trips, and other classes are untouched.
for (const start of [0o000, 0o644, 0o755, 0o777, 0o4711])
  for (const who of classes)
    for (const access of levels) {
      const mode = withAccess(start, who, access);
      assert.equal(accessOf(mode, who), access, `${start.toString(8)} ${who} ${access}`);
      for (const other of classes.filter((candidate) => candidate !== who))
        assert.equal(accessOf(mode, other), accessOf(start, other));
      assert.equal(mode & 0o7000, start & 0o7000, "special bits are kept");
    }
assert.equal(accessOf(0o640, "owner"), "write");
assert.equal(accessOf(0o640, "group"), "read");
assert.equal(accessOf(0o640, "others"), "none");
assert.equal(withAccess(0o755, "others", "none"), 0o751, "files keep their execute bit");
assert.equal(withAccess(0o644, "group", "write"), 0o664);

// Folders: access brings the search bit, none removes it.
assert.equal(withAccess(0o700, "group", "read", true), 0o750);
assert.equal(withAccess(0o700, "others", "write", true), 0o707);
assert.equal(withAccess(0o755, "others", "none", true), 0o750);

// "Allow running as a program".
assert.equal(isExecutable(0o644), false);
assert.equal(withExecutable(0o644, true), 0o755);
assert.equal(withExecutable(0o640, true), 0o750, "only classes that can read gain execute");
assert.equal(withExecutable(0o200, true), 0o300, "the owner always gains execute");
assert.equal(isExecutable(withExecutable(0o644, true)), true);
assert.equal(withExecutable(0o755, false), 0o644);

// Summaries for a selection.
assert.equal(permissionsSummary([0o644, 0o600], [501, 501], 501), "All read & write for you");
assert.equal(permissionsSummary([0o444, 0o400], [501, 501], 501), "All read-only for you");
assert.equal(permissionsSummary([0o644, 0o444], [501, 501], 501), "Mixed permissions");
assert.equal(permissionsSummary([0o644, 0o644], [0, 0], 501), "Owned by someone else");
assert.equal(permissionsSummary([0o644, 0o644], [501, 0], 501), "Mixed permissions");
assert.equal(permissionsSummary([0o644, 0o666], [501, 0], 501), "All read & write for you");
assert.equal(permissionsSummary([0o600], [501], 501), "Read & write for you");
assert.equal(permissionsSummary([0o000, 0o000], [501, 501], 501), "No access for you");
assert.equal(permissionsSummary([], [], 501), "");

// Account files: comments, blank lines, NIS lines and garbage are skipped.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "moire-accounts-"));
try {
  const passwd = path.join(root, "passwd");
  const group = path.join(root, "group");
  await fs.writeFile(
    passwd,
    [
      "# User Database",
      "",
      "root:x:0:0:root:/root:/bin/sh",
      "+nisuser::::::",
      "-blocked::::::",
      "garbled line without fields",
      "bad:x:notanumber:0::/:/bin/sh",
      "alice:x:1000:1000:Alice:/home/alice:/bin/sh",
      "alias:x:1000:1000::/home/alice:/bin/sh",
      "  ",
    ].join("\n"),
  );
  await fs.writeFile(group, "# groups\nwheel:x:0:root\n+:::\nstaff:*:20:alice,bob\n\n");
  const accounts = await readAccounts({ passwd, group });
  assert.equal(accountName(accounts.users, 0), "root");
  assert.equal(accountName(accounts.users, 1000), "alice", "the first name for an id wins");
  assert.equal(accountName(accounts.users, 4242), "4242", "unknown ids fall back to numbers");
  assert.equal(accountName(accounts.groups, 20), "staff");
  assert.equal(accountName(accounts.groups, 0), "wheel");
  assert.ok(![...accounts.users.values()].some((name) => name.startsWith("+") || name === "bad"));
  assert.equal(await readAccounts({ passwd, group }), accounts, "accounts are read once");

  // Missing files give empty maps (plus the signed-in user).
  const missing = await readAccounts({
    passwd: path.join(root, "nope"),
    group: path.join(root, "nope-group"),
  });
  assert.equal(missing.groups.size, 0);
  const me = os.userInfo();
  assert.equal(currentUserName(), me.username);
  assert.equal(accountName(missing.users, me.uid), me.username, "the current user is known");
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

console.log("permissions smoke passed");
