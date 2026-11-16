// Evaluates nix/moire-accounts.rules, moire-admin.rules, moire-network.rules, moire-power.rules
// and moire-settings.rules, then the immutable deny fallback, with mocked polkit
// subjects and first-result dispatch, as polkitd orders /etc/polkit-1/rules.d.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const sources = [
  ["00-moire-accounts.rules", await readFile(new URL("nix/moire-accounts.rules", root), "utf8")],
  ["00-moire-admin.rules", await readFile(new URL("nix/moire-admin.rules", root), "utf8")],
  ["00-moire-network.rules", await readFile(new URL("nix/moire-network.rules", root), "utf8")],
  ["00-moire-power.rules", await readFile(new URL("nix/moire-power.rules", root), "utf8")],
  ["00-moire-settings.rules", await readFile(new URL("nix/moire-settings.rules", root), "utf8")],
  [
    "01-moire-deny-unapproved.rules",
    await readFile(new URL("nix/moire-deny-unapproved.rules", root), "utf8"),
  ],
  ["99-fixture-stock-yes.rules", "polkit.addRule(function() { return polkit.Result.YES; });"],
];
// polkitd reads rules files in name order; this list must be that order.
assert.deepEqual(
  sources.map(([name]) => name),
  sources.map(([name]) => name).sort(),
);
/** The Moire rules files, without the deny fallback and the fixture. */
const moireRules = sources.filter(([name]) => name.startsWith("00-"));
const ruleSource = (name) => sources.find(([file]) => file === name)[1];
const module = await readFile(new URL("nix/moire-settings-services.nix", root), "utf8");
assert.match(
  module,
  /"polkit-1\/rules\.d\/00-moire-settings\.rules"\.source = \.\/moire-settings\.rules;/,
);
assert.match(
  module,
  /"polkit-1\/rules\.d\/00-moire-admin\.rules"\.source = \.\/moire-admin\.rules;/,
);
assert.match(
  module,
  /"polkit-1\/rules\.d\/00-moire-accounts\.rules"\.source = \.\/moire-accounts\.rules;/,
);
// moire-accounts: its action, its bus policy, and a hardened unit as its own system account.
assert.match(module, /share\/polkit-1\/actions\/org\.moire\.accounts\.policy/);
assert.match(module, /share\/dbus-1\/system\.d\/org\.moire\.AccountAdmin1\.conf/);
assert.match(
  module,
  /users\.users\.moire-accounts = \{ isSystemUser = true; group = "moire-accounts"; \};/,
);
const accountsUnit = module.slice(module.indexOf("systemd.services.moire-accounts = {"));
for (const setting of [
  /User = "moire-accounts";/,
  /NoNewPrivileges = true;/,
  /ProtectSystem = "strict";/,
  /ProtectHome = true;/,
  /PrivateNetwork = true;/,
  /CapabilityBoundingSet = "";/,
  /MemoryDenyWriteExecute = true;/,
  /RestrictAddressFamilies = \[ "AF_UNIX" \];/,
  /SystemCallFilter = \[ "@system-service" "~@privileged" \];/,
])
  assert.match(accountsUnit, setting);
assert.doesNotMatch(
  accountsUnit.slice(0, accountsUnit.indexOf("};\n  };")),
  /User = "root"|DynamicUser/,
);
const accountsPolicy = await readFile(new URL("nix/moire-accounts.policy", root), "utf8");
assert.match(accountsPolicy, /<action id="org\.moire\.accounts\.administer">/);
assert.equal((accountsPolicy.match(/<action /g) ?? []).length, 1);
for (const kind of ["allow_any", "allow_inactive", "allow_active"])
  assert.match(accountsPolicy, new RegExp(`<${kind}>no</${kind}>`), `${kind} defaults to no`);
assert.match(
  accountsPolicy,
  /key="org\.freedesktop\.policykit\.owner">unix-user:moire-accounts</,
  "only moire-accounts may check the action for its callers",
);
const accountsBus = await readFile(new URL("nix/moire-accounts-dbus.conf", root), "utf8");
assert.match(
  accountsBus,
  /<policy user="moire-accounts">\s*<allow own="org\.moire\.AccountAdmin1"\/>/,
);
assert.equal((accountsBus.match(/allow own=/g) ?? []).length, 1, "only moire-accounts owns it");
assert.match(
  accountsBus,
  /<policy user="greeter">\s*<deny send_destination="org\.moire\.AccountAdmin1"\/>/,
);
// An administrator prompt accepts wheel's passwords: the NixOS default, kept by an assertion.
assert.match(module, /security\.polkit\.adminIdentities == \[ "unix-group:wheel" \]/);
assert.match(
  module,
  /"polkit-1\/rules\.d\/01-moire-deny-unapproved\.rules"\.source = \.\/moire-deny-unapproved\.rules;/,
);

const powerModule = await readFile(new URL("nix/moire-power-services.nix", root), "utf8");
assert.match(
  powerModule,
  /"polkit-1\/rules\.d\/00-moire-power\.rules"\.source = \.\/moire-power\.rules;/,
);

const networkModule = await readFile(new URL("nix/moire-network-services.nix", root), "utf8");
assert.match(
  networkModule,
  /"polkit-1\/rules\.d\/00-moire-network\.rules"\.source = \.\/moire-network\.rules;/,
);
// The grant only means something under Polkit: the native module must not turn NetworkManager's
// Polkit checks off, and the QEMU module that does must refuse to share an image with it.
assert.doesNotMatch(networkModule.replace(/#.*$/gm, ""), /auth-polkit\s*=/);
const desktopServices = await readFile(new URL("nix/moire-desktop-services.nix", root), "utf8");
assert.match(desktopServices, /"polkit-1\/rules\.d\/00-moire-network\.rules"/);
const nativeImage = await readFile(new URL("nix/moire-native-desktop-image.nix", root), "utf8");
assert.match(nativeImage, /\.\/moire-network-services\.nix/);
assert.match(nativeImage, /networkControl = "interactive";/);
assert.match(nativeImage, /"nix\/moire-network\.rules"/);
assert.doesNotMatch(nativeImage, /moire-desktop-services\.nix/);

// moire-dm installs its action's definition and the bus policy, and requires the administrator
// rule and the deny fallback. It has no rules file of its own any more: the old
// 00-moire-dm.rules was a YES for wheel.
const dmModule = await readFile(new URL("nix/moire-dm.nix", root), "utf8");
assert.doesNotMatch(dmModule, /00-moire-dm\.rules|moire-dm\.rules/);
assert.match(dmModule, /share\/polkit-1\/actions\/org\.moire\.dm\.policy/);
assert.match(dmModule, /config\.environment\.etc \? "polkit-1\/rules\.d\/00-moire-admin\.rules"/);
assert.match(dmModule, /01-moire-deny-unapproved\.rules/);
assert.match(nativeImage, /"nix\/moire-admin\.rules"/);
assert.match(nativeImage, /"nix\/moire-accounts\.rules"/);
const dmPolicy = await readFile(new URL("nix/moire-dm.policy", root), "utf8");
assert.match(dmPolicy, /<action id="org\.moire\.dm\.set-autologin">/);
for (const kind of ["allow_any", "allow_inactive", "allow_active"])
  assert.match(dmPolicy, new RegExp(`<${kind}>no</${kind}>`), `${kind} defaults to no`);
assert.match(
  dmPolicy,
  /key="org\.freedesktop\.policykit\.owner">unix-user:moire-dm-settings</,
  "only moire-dm-settings may check the action for its callers",
);
assert.equal((dmPolicy.match(/<action /g) ?? []).length, 1);

// Polkit 127 runs rules in Duktape (ES5): no ES2015+ syntax or library calls.
for (const [, source] of moireRules) {
  const code = source.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\b(?:let|const|class)\b|=>|`|\?\.|\?\?|\.includes\(|\.startsWith\(/);
  new vm.Script(source);
}

function decide(actionId, subject) {
  const rules = [];
  const context = vm.createContext({
    polkit: {
      Result: {
        YES: "yes",
        NO: "no",
        AUTH_ADMIN: "auth_admin",
        AUTH_ADMIN_KEEP: "auth_admin_keep",
        AUTH_SELF: "auth_self",
        AUTH_SELF_KEEP: "auth_self_keep",
      },
      addRule: (callback) => rules.push(callback),
      log() {},
    },
  });
  const names = [];
  for (const [name, source] of sources) {
    const before = rules.length;
    new vm.Script(source, { filename: name }).runInContext(context, { timeout: 100 });
    for (let index = before; index < rules.length; index++) names.push(name);
  }
  const groups = subject.groups ?? [];
  context.fixtureAction = { id: actionId, lookup: () => undefined };
  context.fixtureSubject = { ...subject, isInGroup: (group) => groups.indexOf(group) !== -1 };
  for (let index = 0; index < rules.length; index++) {
    context.fixtureRule = rules[index];
    const result = new vm.Script("fixtureRule(fixtureAction, fixtureSubject)").runInContext(
      context,
      { timeout: 100 },
    );
    if (result !== undefined && result !== null) return { result, rule: names[index] };
  }
  return { result: undefined, rule: null };
}

const user = { user: "moire-pam-test", pid: 4242, local: true, active: true, groups: ["users"] };
const admin = { ...user, user: "joshua", groups: ["users", "wheel"] };
let cases = 0;
function expect(action, subject, result, rule) {
  const decision = decide(action, subject);
  assert.equal(decision.result, result, `${action} for ${JSON.stringify(subject)}`);
  if (rule) assert.equal(decision.rule, rule);
  cases++;
}

const own = [
  "org.freedesktop.accounts.change-own-user-data",
  "org.freedesktop.timedate1.set-timezone",
  "org.freedesktop.timedate1.set-ntp",
];
for (const action of own) {
  expect(action, user, "yes", "00-moire-settings.rules");
  expect(action, admin, "yes", "00-moire-settings.rules");
  for (const field of ["local", "active"])
    for (const value of [false, undefined, "true", 1])
      expect(action, { ...user, [field]: value }, "no", "01-moire-deny-unapproved.rules");
}

// Administrator actions (00-moire-admin.rules): an administrator's password for every check,
// never kept (polkit keeps an authorization session-wide, not per process), for any active local
// user. A standard user gets the same answer: an administrator types their password at the
// prompt. The rule itself answers NO for the greeter account and for inactive and remote
// subjects, before its prompt branch. Both are asked for by Settings itself (moire-accounts,
// moire-dm-settings), so the prompt names Settings.
const administration = "org.freedesktop.accounts.user-administration";
const accountsAction = "org.moire.accounts.administer";
const autologin = "org.moire.dm.set-autologin";
const administrator = [accountsAction, autologin];
const greeter = { ...user, user: "greeter", groups: ["greeter"] };
for (const action of administrator) {
  expect(action, admin, "auth_admin", "00-moire-admin.rules");
  expect(action, user, "auth_admin", "00-moire-admin.rules");
  for (const subject of [admin, user])
    for (const field of ["local", "active"])
      for (const value of [false, undefined, "true", 1])
        expect(action, { ...subject, [field]: value }, "no", "00-moire-admin.rules");
  expect(action, { ...admin, local: false, active: false }, "no", "00-moire-admin.rules");
  // Group names don't matter to the rule: who may answer is polkit's adminIdentities.
  expect(action, { ...user, groups: [] }, "auth_admin", "00-moire-admin.rules");
  // The greeter: NO even in an active, local session, by name or by group.
  expect(action, greeter, "no", "00-moire-admin.rules");
  expect(action, { ...greeter, active: false }, "no", "00-moire-admin.rules");
  expect(action, { ...greeter, local: false }, "no", "00-moire-admin.rules");
  expect(action, { ...greeter, groups: [] }, "no", "00-moire-admin.rules");
  expect(action, { ...user, groups: ["users", "greeter"] }, "no", "00-moire-admin.rules");
}
// No other Moire rule mentions them; user-administration only 00-moire-accounts.rules does.
for (const [name, source] of moireRules) {
  for (const action of administrator)
    if (name !== "00-moire-admin.rules")
      assert.doesNotMatch(
        source.replace(/\/\/.*$/gm, ""),
        new RegExp(action.replace(/\./g, "\\.")),
      );
  if (name !== "00-moire-accounts.rules")
    assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), /accounts\.user-administration/, name);
}
// Exactly these two actions ask for a password; nothing else in any Moire rule does. The rule
// answers only NO or AUTH_ADMIN: never YES, and never a kept authorization.
const adminRules = ruleSource("00-moire-admin.rules").replace(/\/\/.*$/gm, "");
assert.deepEqual(
  adminRules.match(/"[^"]+"/g).filter((quoted) => quoted !== '"root"' && quoted !== '"greeter"'),
  administrator.map((id) => `"${id}"`),
);
assert.deepEqual([...new Set(adminRules.match(/polkit\.Result\.[A-Z_]+/g) ?? [])].sort(), [
  "polkit.Result.AUTH_ADMIN",
  "polkit.Result.NO",
]);
for (const [, source] of moireRules)
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), /_KEEP\b/);
for (const [name, source] of sources)
  if (name === "00-moire-settings.rules" || name === "00-moire-network.rules")
    assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), /AUTH_/);

// Never granted: own password (AccountsService skips the current-password check), the clock,
// RTC mode, automatic login, and stock allow_active actions from other services.
for (const action of [
  "org.freedesktop.accounts.change-own-password",
  "org.freedesktop.accounts.set-login-option",
  "org.freedesktop.timedate1.set-time",
  "org.freedesktop.timedate1.set-local-rtc",
  "org.freedesktop.hostname1.set-hostname",
  "org.freedesktop.timedate1.set-timezone-extra",
  "ORG.FREEDESKTOP.TIMEDATE1.SET-TIMEZONE",
  "",
]) {
  expect(action, user, "no", "01-moire-deny-unapproved.rules");
  expect(action, admin, "no", "01-moire-deny-unapproved.rules");
}

// Power & idle (00-moire-power.rules): logind sleep, restart, power off, the session's handling
// and sleep-delay inhibitors, and power-profiles-daemon's switch, for active local sessions only.
for (const action of [
  "org.freedesktop.login1.suspend",
  "org.freedesktop.login1.reboot",
  "org.freedesktop.login1.power-off",
  "org.freedesktop.login1.inhibit-handle-lid-switch",
  "org.freedesktop.login1.inhibit-handle-power-key",
  "org.freedesktop.login1.inhibit-handle-suspend-key",
  "org.freedesktop.login1.inhibit-delay-sleep",
  "org.freedesktop.UPower.PowerProfiles.switch-profile",
  "net.hadess.PowerProfiles.switch-profile",
]) {
  expect(action, user, "yes", "00-moire-power.rules");
  expect(action, admin, "yes", "00-moire-power.rules");
  for (const field of ["local", "active"])
    for (const value of [false, undefined, "true", 1])
      expect(action, { ...user, [field]: value }, "no", "01-moire-deny-unapproved.rules");
}
// Not granted: overriding other sessions or inhibitors, hibernate, block-mode sleep and shutdown
// inhibitors, holding a profile, rebooting into firmware or a chosen boot entry.
for (const action of [
  "org.freedesktop.login1.suspend-multiple-sessions",
  "org.freedesktop.login1.suspend-ignore-inhibit",
  "org.freedesktop.login1.reboot-multiple-sessions",
  "org.freedesktop.login1.reboot-ignore-inhibit",
  "org.freedesktop.login1.set-reboot-to-firmware-setup",
  "org.freedesktop.login1.set-reboot-to-boot-loader-entry",
  "org.freedesktop.login1.reboot.extra",
  "org.freedesktop.login1.power-off-multiple-sessions",
  "org.freedesktop.login1.power-off-ignore-inhibit",
  "org.freedesktop.login1.hibernate",
  "org.freedesktop.login1.inhibit-block-sleep",
  "org.freedesktop.login1.inhibit-block-shutdown",
  "org.freedesktop.login1.inhibit-handle-hibernate-key",
  "org.freedesktop.UPower.PowerProfiles.hold-profile",
  "org.freedesktop.login1.suspend.extra",
]) {
  expect(action, user, "no", "01-moire-deny-unapproved.rules");
  expect(action, admin, "no", "01-moire-deny-unapproved.rules");
}

// Networking (00-moire-network.rules): connect, disconnect and forget Wi-Fi, VPNs, the radio
// switches behind airplane mode, and the proxy of the user's own profiles, for active local
// sessions only. No group is needed: any active local user controls the network they sit at.
const network = [
  "org.freedesktop.NetworkManager.network-control",
  "org.freedesktop.NetworkManager.settings.modify.own",
  "org.freedesktop.NetworkManager.wifi.scan",
  "org.freedesktop.NetworkManager.enable-disable-wifi",
  "org.freedesktop.NetworkManager.enable-disable-wwan",
];
for (const action of network) {
  expect(action, user, "yes", "00-moire-network.rules");
  expect(action, admin, "yes", "00-moire-network.rules");
  for (const field of ["local", "active"])
    for (const value of [false, undefined, "true", 1])
      expect(action, { ...user, [field]: value }, "no", "01-moire-deny-unapproved.rules");
  // An inactive session at the seat, and a remote one, even an administrator's.
  expect(action, { ...admin, active: false }, "no", "01-moire-deny-unapproved.rules");
  expect(action, { ...admin, local: false }, "no", "01-moire-deny-unapproved.rules");
  expect(action, { ...user, local: false, active: false }, "no", "01-moire-deny-unapproved.rules");
}
// Not granted: shared (system) profiles, networking on/off, sleep, hotspots, hostname, global
// DNS, statistics, connectivity checking, checkpoints, reload; near-miss ids.
for (const action of [
  "org.freedesktop.NetworkManager.settings.modify.system",
  "org.freedesktop.NetworkManager.settings.modify.hostname",
  "org.freedesktop.NetworkManager.settings.modify.global-dns",
  "org.freedesktop.NetworkManager.enable-disable-network",
  "org.freedesktop.NetworkManager.enable-disable-wimax",
  "org.freedesktop.NetworkManager.enable-disable-statistics",
  "org.freedesktop.NetworkManager.enable-disable-connectivity-check",
  "org.freedesktop.NetworkManager.sleep-wake",
  "org.freedesktop.NetworkManager.wifi.share.open",
  "org.freedesktop.NetworkManager.wifi.share.protected",
  "org.freedesktop.NetworkManager.checkpoint-rollback",
  "org.freedesktop.NetworkManager.reload",
  "org.freedesktop.NetworkManager.network-control.extra",
  "ORG.FREEDESKTOP.NETWORKMANAGER.NETWORK-CONTROL",
  "org.freedesktop.NetworkManager.",
  "org.freedesktop.ModemManager1.Device.Control",
  "org.bluez.adapter.power",
]) {
  expect(action, user, "no", "01-moire-deny-unapproved.rules");
  expect(action, admin, "no", "01-moire-deny-unapproved.rules");
}

// moire-dm-settings' own account gets the same answer from the rule as anyone at the seat; it
// can't use it, since moire-dm-settings refuses accounts below uid 1000 before it asks polkit.
// The greeter is refused by the rule itself (above).
expect(
  autologin,
  { ...user, user: "moire-dm-settings", groups: ["moire-dm-settings"] },
  "auth_admin",
  "00-moire-admin.rules",
);
// The rule grants nothing else, not even to an administrator, and near-miss ids fall through.
for (const action of [
  "org.moire.dm.set-autologin.extra",
  "ORG.MOIRE.DM.SET-AUTOLOGIN",
  "org.moire.dm.restart",
  "org.freedesktop.accounts.set-login-option",
  "org.freedesktop.accounts.user-administration.extra",
  "ORG.FREEDESKTOP.ACCOUNTS.USER-ADMINISTRATION",
  "org.freedesktop.systemd1.manage-units",
]) {
  expect(action, admin, "no", "01-moire-deny-unapproved.rules");
  expect(action, user, "no", "01-moire-deny-unapproved.rules");
}

// AccountsService's user-administration (00-moire-accounts.rules): NO, with no prompt, for every
// session. Nothing in Moire calls it from one any more (Settings calls moire-accounts), so
// busctl or a rogue app gets a refusal rather than a prompt it could pass off as the system's.
// Wheel or not, active and local or not, and the greeter.
for (const subject of [
  admin,
  user,
  { ...user, groups: [] },
  { ...admin, active: false },
  { ...admin, local: false },
  { ...user, local: false, active: false },
  greeter,
  { ...greeter, active: false },
  { ...user, user: "moire-dm-settings", groups: ["moire-dm-settings"] },
  { ...user, user: "moire-dm-front", groups: ["moire-dm-front"] },
])
  expect(administration, subject, "no", "00-moire-accounts.rules");

// moire-accounts' grant (00-moire-accounts.rules): user-administration for that system account,
// which is in no session, so it holds without one; nothing else, and for no one else.
const accountsService = {
  user: "moire-accounts",
  pid: 777,
  local: false,
  active: false,
  groups: ["moire-accounts"],
};
expect(administration, accountsService, "yes", "00-moire-accounts.rules");
expect(
  administration,
  { ...accountsService, local: true, active: true },
  "yes",
  "00-moire-accounts.rules",
);
for (const action of [
  accountsAction,
  autologin,
  "org.freedesktop.accounts.change-own-user-data",
  "org.freedesktop.accounts.set-login-option",
  "org.freedesktop.accounts.user-administration.extra",
  "org.freedesktop.systemd1.manage-units",
])
  expect(action, accountsService, "no", undefined);
// A look-alike account, or the group alone, gets nothing from it: a NO, like any session.
for (const subject of [
  { ...user, user: "moire-accounts2" },
  { ...user, user: "Moire-Accounts" },
  { ...user, groups: ["users", "moire-accounts"] },
  { ...admin, user: "moire-account" },
  { ...admin, user: "root2" },
  { ...admin, groups: ["users", "wheel", "root"] },
])
  expect(administration, subject, "no", "00-moire-accounts.rules");
const accountsRules = ruleSource("00-moire-accounts.rules").replace(/\/\/.*$/gm, "");
assert.deepEqual(accountsRules.match(/"[^"]+"/g), [
  `"${administration}"`,
  '"moire-accounts"',
  '"root"',
]);
assert.deepEqual([...new Set(accountsRules.match(/polkit\.Result\.[A-Z_]+/g))].sort(), [
  "polkit.Result.NO",
  "polkit.Result.YES",
]);
// It decides only user-administration: the user's own changes are not its business.
for (const action of [
  "org.freedesktop.accounts.change-own-user-data",
  "org.freedesktop.accounts.change-own-password",
])
  for (const subject of [admin, user])
    assert.notEqual(decide(action, subject).rule, "00-moire-accounts.rules");
assert.equal((accountsRules.match(/polkit\.addRule/g) ?? []).length, 1);

// Root keeps stock authority: neither Moire rule decides for it.
for (const action of [
  administration,
  accountsAction,
  autologin,
  "org.freedesktop.NetworkManager.settings.modify.system",
])
  expect(
    action,
    { user: "root", pid: 1, local: false, active: false },
    "yes",
    "99-fixture-stock-yes.rules",
  );

console.log(JSON.stringify({ ok: true, cases }));
