import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const files = [
  ["00-moire-removable.rules", new URL("nix/moire-removable.rules", root)],
  ["01-moire-deny-unapproved.rules", new URL("nix/moire-deny-unapproved.rules", root)],
];
const sources = await Promise.all(
  files.map(async ([name, url]) => ({ name, source: await readFile(url, "utf8"), url })),
);
const eligible = [
  "org.freedesktop.udisks2.filesystem-mount",
  "org.freedesktop.udisks2.eject-media",
  "org.freedesktop.udisks2.power-off-drive",
];
const stock = {
  name: "99-fixture-stock-yes.rules",
  source: "polkit.addRule(function() { return polkit.Result.YES; });",
};
let cases = 0;

// A conservative scan of the actual rule syntax/APIs, not a full ES5 parser.
// vm.Script independently checks syntax; strings/comments cannot mask code.
function checkLegacySyntax(source) {
  let code = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    assert.notEqual(char, "`", "Polkit rules must not use template literals");
    if (char === '"' || char === "'") {
      const quote = char;
      code += " ";
      while (++i < source.length) {
        if (source[i] === "\\") i++;
        else if (source[i] === quote) break;
      }
      continue;
    }
    if (char === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      code += "\n";
      continue;
    }
    if (char === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i++;
      code += " ";
      continue;
    }
    code += char;
  }
  assert.doesNotMatch(code, /\b(?:let|const|class|async|await|import|export|yield)\b/);
  assert.doesNotMatch(code, /=>|\.\.\.|\?\.|\?\?|\*\*|\bfunction\s*\*/);
  assert.doesNotMatch(code, /\bvar\s*[[{]|\bcatch\s*\{|\bfor\s*\([^)]*\bof\b/);
  assert.doesNotMatch(code, /\b\d[\d_]*n\b|\b\d+_\d+/);
  assert.doesNotMatch(code, /\b(?:Map|Set|Promise|BigInt|Symbol)\b/);
  assert.doesNotMatch(code, /\.(?:includes|startsWith|endsWith|at)\s*\(/);
  assert.doesNotMatch(code, /\b(?:Array\.from|Object\.(?:assign|entries|values))\s*\(/);
  new vm.Script(source);
}

function dispatch(ruleSources, actionId, subject, removable) {
  const rules = [];
  const trace = [];
  const logs = [];
  let registering;
  const context = vm.createContext({
    polkit: {
      Result: { YES: "yes", NO: "no" },
      addRule(callback) {
        assert.equal(typeof callback, "function");
        rules.push({ name: registering, callback });
      },
      log(message) {
        logs.push(message);
      },
    },
  });
  for (const { name, source } of ruleSources) {
    registering = name;
    new vm.Script(source, { filename: name }).runInContext(context, { timeout: 100 });
  }
  context.fixtureAction = {
    id: actionId,
    lookup(key) {
      assert.equal(key, "drive.removable");
      return removable;
    },
  };
  context.fixtureSubject = subject;
  const invoke = new vm.Script("fixtureRule(fixtureAction, fixtureSubject)");
  for (const { name, callback } of rules) {
    trace.push(name);
    context.fixtureRule = callback;
    const result = invoke.runInContext(context, { timeout: 100 });
    if (result === undefined || result === null) continue;
    assert.ok(result === "yes" || result === "no", "unexpected policy result");
    return { result, trace, logs };
  }
  return { result: undefined, trace, logs };
}

const subject = { user: "moire", pid: 4242, local: true, active: true, seat: "seat0" };
const ordered = [...sources, stock];
function check(name, action, actor, removable, expected, expectedTrace, rules = ordered) {
  const observed = dispatch(rules, action, actor, removable);
  assert.equal(observed.result, expected, name);
  assert.deepEqual(observed.trace, expectedTrace, `${name}: first decisive rule wins`);
  cases++;
  return observed;
}
const allowTrace = [files[0][0]];
const denyTrace = files.map(([name]) => name);
const stockTrace = [...denyTrace, stock.name];

for (const source of sources) checkLegacySyntax(source.source);
checkLegacySyntax("// const ignored\nvar text = 'async =>';");
for (const modern of [
  "const value = 1;",
  "var value = () => 1;",
  "var value = `text`;",
  "var value = object?.value;",
  "var value = array.includes(1);",
]) {
  assert.throws(() => checkLegacySyntax(modern));
  cases++;
}

for (const action of eligible) {
  const observed = check(action, action, subject, "true", "yes", allowTrace);
  assert.equal(observed.logs.length, 1);
  assert.ok(observed.logs[0].startsWith("MOIRE_STORAGE_AUTH "));
  assert.deepEqual(JSON.parse(observed.logs[0].slice("MOIRE_STORAGE_AUTH ".length)), {
    action,
    pid: subject.pid,
    user: subject.user,
    local: true,
    active: true,
    removable: "true",
    permitted: true,
  });
  // Authority is for active local users, not a username or seat0 allowlist.
  check(
    `${action}: another active local user on matching seat`,
    action,
    { ...subject, user: "fixture-user", seat: "seat1" },
    "true",
    "yes",
    allowTrace,
  );
  for (const id of ["x" + action, action + "-system", action + "-other-seat", action + "-extra"])
    check(id, id, subject, "true", "no", denyTrace);
  for (const field of ["local", "active"]) {
    for (const value of [false, undefined, null, "true", 1]) {
      check(
        `${action}: ${field}=${String(value)}`,
        action,
        { ...subject, [field]: value },
        "true",
        "no",
        denyTrace,
      );
    }
    const missing = { ...subject };
    delete missing[field];
    check(`${action}: absent ${field}`, action, missing, "true", "no", denyTrace);
  }
  for (const value of [false, true, "false", "TRUE", "true ", "", undefined, null, 1])
    check(`${action}: removable=${String(value)}`, action, subject, value, "no", denyTrace);
}

for (const action of [
  "org.freedesktop.udisks2.filesystem-mount-other-user",
  "org.freedesktop.udisks2.filesystem-unmount-others",
  "org.freedesktop.udisks2.modify-device",
  "org.freedesktop.udisks2.modify-device-system",
  "org.freedesktop.udisks2.encrypted-unlock",
  "org.freedesktop.udisks2.loop-setup",
  "org.freedesktop.udisks2.manage-md-raid",
  "org.freedesktop.udisks2.format",
  "org.freedesktop.NetworkManager.network-control",
  "org.freedesktop.login1.power-off",
  "ORG.FREEDESKTOP.UDISKS2.FILESYSTEM-MOUNT",
  "",
])
  check(action, action, subject, "true", "no", denyTrace);

for (const action of [...eligible, "org.freedesktop.udisks2.modify-device"]) {
  const rootActor = { user: "root", pid: 1 };
  check(`${action}: root unhandled`, action, rootActor, undefined, undefined, denyTrace, sources);
  check(
    `${action}: root stock authority unchanged`,
    action,
    rootActor,
    undefined,
    "yes",
    stockTrace,
  );
}

const malformed = { name: files[0][0], source: "polkit.addRule(function( {" };
assert.throws(() => dispatch([malformed], eligible[0], subject), SyntaxError);
cases++;
for (const scenario of ["missing editable allow", "syntax-malformed editable allow"]) {
  // Syntax errors prevent registration. The immutable guard is a separate file.
  const fallback = [sources[1], stock];
  for (const action of eligible)
    check(scenario, action, subject, "true", "no", [files[1][0]], fallback);
  check(
    `${scenario}: root unchanged`,
    eligible[0],
    { user: "root" },
    undefined,
    "yes",
    [files[1][0], stock.name],
    fallback,
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      cases,
      rules: sources.map(({ name, url, source }) => ({
        name,
        path: fileURLToPath(url),
        sha256: createHash("sha256").update(source).digest("hex"),
      })),
      scope:
        "Exact rule evaluation with mocked Polkit subjects, lookups and first-result dispatch; no real authorization or disk operations.",
      limits: [
        "The conservative syntax/API scan is not a complete ES5 parser.",
        "Missing or syntax-invalid allowance is denied by the later immutable guard; an earlier explicit broad YES cannot be overridden.",
        "Subject local/active and drive.removable facts are supplied by UDisks/Polkit; native daemon provenance is a separate acceptance gate.",
      ],
    },
    null,
    2,
  ),
);
