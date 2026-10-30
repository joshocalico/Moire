// Evaluates nix/moire-admin.rules, moire-network.rules, moire-power.rules and moire-settings.rules,
// then the immutable deny fallback, with mocked polkit
// subjects and first-result dispatch, as polkitd orders /etc/polkit-1/rules.d.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const sources = [
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
const module = await readFile(new URL("nix/moire-settings-services.nix", root), "utf8");
assert.match(
  module,
  /"polkit-1\/rules\.d\/00-moire-settings\.rules"\.source = \.\/moire-settings\.rules;/,
);
assert.match(
  module,
  /"polkit-1\/rules\.d\/00-moire-admin\.rules"\.source = \.\/moire-admin\.rules;/,
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
for (const [, source] of sources.slice(0, 4)) {
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

// Administrator actions (00-moire-admin.rules): an administrator's password, kept for five
// minutes, for any active local user. A standard user gets the same answer: an administrator
// types their password at the prompt. Inactive and remote subjects are denied outright.
const administration = "org.freedesktop.accounts.user-administration";
const autologin = "org.moire.dm.set-autologin";
const administrator = [administration, autologin];
for (const action of administrator) {
  expect(action, admin, "auth_admin_keep", "00-moire-admin.rules");
  expect(action, user, "auth_admin_keep", "00-moire-admin.rules");
  for (const subject of [admin, user])
    for (const field of ["local", "active"])
      for (const value of [false, undefined, "true", 1])
        expect(action, { ...subject, [field]: value }, "no", "01-moire-deny-unapproved.rules");
  expect(action, { ...admin, local: false, active: false }, "no", "01-moire-deny-unapproved.rules");
  // Group names don't matter to the rule: who may answer is polkit's adminIdentities.
  expect(action, { ...user, groups: [] }, "auth_admin_keep", "00-moire-admin.rules");
}
// No Moire rule answers YES for them any more, whoever asks.
for (const [name, source] of sources.slice(0, 4))
  for (const action of administrator)
    if (name !== "00-moire-admin.rules")
      assert.doesNotMatch(
        source.replace(/\/\/.*$/gm, ""),
        new RegExp(action.replace(/\./g, "\\.")),
      );
// Exactly these two actions ask for a password; nothing else in any Moire rule does.
const adminRules = sources[0][1].replace(/\/\/.*$/gm, "");
assert.deepEqual(
  adminRules.match(/"[^"]+"/g).filter((quoted) => quoted !== '"root"'),
  administrator.map((id) => `"${id}"`),
);
assert.equal(
  (adminRules.match(/polkit\.Result\.[A-Z_]+/g) ?? []).join(),
  "polkit.Result.AUTH_ADMIN_KEEP",
);
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

// Automatic login: the greeter's and moire-dm-settings' own accounts get the same answer from
// the rule as anyone at the seat. Neither can use it: a greeter session has no authentication
// agent, and moire-dm-settings refuses accounts below uid 1000 before it asks polkit.
expect(
  autologin,
  { ...user, user: "greeter", groups: ["greeter"] },
  "auth_admin_keep",
  "00-moire-admin.rules",
);
expect(
  autologin,
  { ...user, user: "greeter", groups: ["greeter"], active: false },
  "no",
  "01-moire-deny-unapproved.rules",
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

// Root keeps stock authority: neither Moire rule decides for it.
for (const action of [
  administration,
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
