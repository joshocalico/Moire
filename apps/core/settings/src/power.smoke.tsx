/**
 * Power & Battery's "Apps that can keep this computer awake": the list is built from the stored
 * grants and the requests the compositor reports, every switch starts off, turning one on writes
 * a grant keyed by the compositor's identity, an app that could not be identified has no usable
 * switch, and an X11 app says what allowing it covers. Pure model cases first.
 * `SETTINGS_PNG_DIR` saves the section.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { DEFAULT_POWER_SETTINGS, applyPowerPatch, loadSettings } from "@moire/prefs";
import { windowControlTexts, withFixture } from "@moire/app-tools/testing";
import { setUiScaleFactor } from "@moire/ui";
import {
  FAKE_IDLE_STATUS,
  createFakePowerSettingsClient,
  parseIdleStatus,
  type SleepBlockerRequest,
} from "@moire/system-management/power-settings";
import { awakeApps, awakeFootnote } from "./pages/power-model";
import { settingsFixture } from "./testing";
import { mountSettings, overflow } from "./testing-ui";

const pictures = process.env.SETTINGS_PNG_DIR;
const TERMINAL = { id: "launch:moire-terminal", name: "Terminal", x11: false };
const XTERM = { id: "launch:/usr/bin/xterm", name: "xterm", x11: true };
const BACKUP = { id: "exe:/usr/bin/backupd", name: "backupd", x11: false };
const request = (
  app: { id: string | null; name: string; x11: boolean },
  state: Partial<SleepBlockerRequest> = {},
): SleepBlockerRequest => ({ ...app, allowed: false, holding: false, ...state });

// ---- Model: requests in the compositor's order, then grants that have not asked; the stored
// grants decide what is allowed; an unidentified app has nothing to grant.
{
  assert.deepEqual(awakeApps([], []), []);
  const apps = awakeApps(
    [BACKUP, TERMINAL],
    [
      request(TERMINAL, { holding: true }),
      request(XTERM, { holding: true }),
      request({ id: null, name: "org.mozilla.firefox", x11: false }),
    ],
  );
  assert.deepEqual(
    apps.map((app) => [app.name, app.allowed, app.grant?.id ?? null, app.detail]),
    [
      ["Terminal", true, TERMINAL.id, "Keeping this computer awake now"],
      ["xterm", false, XTERM.id, "Asking now, but closing the lid still sleeps · Runs under X11"],
      [
        "Unidentified app (org.mozilla.firefox)",
        false,
        null,
        "Couldn't be identified, so it can't be allowed",
      ],
      ["backupd", true, BACKUP.id, "Can keep this computer awake"],
    ],
  );
  assert.match(awakeFootnote(apps), /^Off unless you turn it on\./);
  assert.match(awakeFootnote(apps), /allowing one allows them all\.$/);
  assert.doesNotMatch(awakeFootnote(apps.slice(0, 1)), /X11/);
  assert.equal(awakeApps([], [request(TERMINAL)])[0]?.detail, "Asked to keep this computer awake");

  // Prefs: nothing is allowed by default, and a hand-edited list keeps only well-formed grants.
  assert.deepEqual(DEFAULT_POWER_SETTINGS.sleepBlockers, []);
  assert.deepEqual(
    applyPowerPatch(DEFAULT_POWER_SETTINGS, {
      sleepBlockers: [
        TERMINAL,
        { ...TERMINAL, name: "Twice" },
        { id: "Terminal", name: "No identity kind", x11: false },
        { id: "exe:/bin/a\nb", name: "Control character", x11: false },
        "junk",
      ] as never,
    }).sleepBlockers,
    [TERMINAL],
  );

  // Wire: a compositor older than the allowlist reports nobody; a malformed entry is refused.
  const { sleepBlocking: _omitted, ...older } = FAKE_IDLE_STATUS;
  assert.deepEqual(parseIdleStatus(older).sleepBlocking, { requests: [], lidHeld: false });
  assert.throws(() =>
    parseIdleStatus({
      ...FAKE_IDLE_STATUS,
      sleepBlocking: { requests: [{ id: 7 }], lidHeld: false },
    }),
  );
}

await withFixture(async () => {
  const mount = async (
    power: ReturnType<typeof createFakePowerSettingsClient>,
    width: number,
    height: number,
  ) =>
    mountSettings(settingsFixture(loadSettings(), { page: "power#awake", services: { power } }), {
      width,
      height,
    });
  const shows = async (app: Awaited<ReturnType<typeof mountSettings>>, text: string) =>
    app.until(() => app.texts().includes(text), `Missing “${text}”: ${app.texts().join(" | ")}`);
  const idleWith = (requests: SleepBlockerRequest[], lidHeld = false) => ({
    ...FAKE_IDLE_STATUS,
    sleepBlocking: { requests, lidHeld },
  });
  setUiScaleFactor(1);

  // ---- Nobody has asked: the section says so and offers no switch.
  {
    const power = createFakePowerSettingsClient();
    const app = await mount(power, 1020, 1600);
    await shows(app, "Apps that can keep this computer awake");
    await shows(app, "No app has asked");
    app.destroy();
  }

  // ---- Apps that asked: off by default; a switch writes the grant and takes it back.
  {
    const asking = [
      request(TERMINAL, { holding: true }),
      request(XTERM),
      request({ id: null, name: "org.mozilla.firefox", x11: false }, { holding: true }),
    ];
    const power = createFakePowerSettingsClient({ idle: idleWith(asking) });
    const app = await mount(power, 1020, 1600);
    await shows(app, "Terminal");
    await shows(app, "Asking now, but closing the lid still sleeps");
    await shows(app, "Asked to keep this computer awake · Runs under X11");
    await shows(app, "Unidentified app (org.mozilla.firefox)");
    assert.deepEqual(power.state.settings.sleepBlockers, [], "nothing is allowed until asked");

    app.press({ focusId: `power:awake:${TERMINAL.id}` });
    await app.until(() => power.state.settings.sleepBlockers.length === 1, "grant written");
    assert.deepEqual(power.state.settings.sleepBlockers, [TERMINAL]);
    // The compositor then reports it as allowed and holding.
    power.emitIdle(
      idleWith([request(TERMINAL, { holding: true, allowed: true }), ...asking.slice(1)]),
    );
    await shows(app, "Keeping this computer awake now");

    // An X11 app's grant is stored with that fact, so the row keeps saying so.
    app.press({ focusId: `power:awake:${XTERM.id}` });
    await app.until(() => power.state.settings.sleepBlockers.length === 2, "X11 grant written");
    assert.deepEqual(power.state.settings.sleepBlockers[1], XTERM);
    await shows(app, "Can keep this computer awake · Runs under X11");

    // An app with no identity cannot be allowed.
    assert.throws(
      () => app.press({ focusId: "power:awake:unidentified:org.mozilla.firefox" }),
      /No visible control/,
      "its switch is disabled",
    );

    app.press({ focusId: `power:awake:${TERMINAL.id}` });
    await app.until(() => power.state.settings.sleepBlockers.length === 1, "grant removed");
    assert.deepEqual(power.state.settings.sleepBlockers, [XTERM]);
    await shows(app, "Asking now, but closing the lid still sleeps");
    app.destroy();
  }

  // ---- The power button's menu shows its setting: the default is one it offers, and an "ask"
  // stored by an earlier build (no power menu exists to ask with) shows as what it does.
  assert.notEqual(DEFAULT_POWER_SETTINGS.powerButtonAction, "ask");
  for (const [stored, label] of [
    [DEFAULT_POWER_SETTINGS.powerButtonAction, "Suspend"],
    ["power-off", "Shut down"],
    ["ask", "Do nothing"],
  ] as const) {
    const power = createFakePowerSettingsClient({
      settings: applyPowerPatch(DEFAULT_POWER_SETTINGS, { powerButtonAction: stored }),
    });
    const app = await mount(power, 1020, 1600);
    await shows(app, "Power button");
    assert.deepEqual(windowControlTexts(app.window, "setting:power.power-button"), [label]);
    app.destroy();
  }

  // ---- An allowed app that has not asked this session is still listed, so it can be removed.
  for (const [width, height] of [
    [1020, 700],
    [640, 650],
  ] as const) {
    const power = createFakePowerSettingsClient({
      settings: applyPowerPatch(DEFAULT_POWER_SETTINGS, { sleepBlockers: [BACKUP, XTERM] }),
      idle: idleWith([request(TERMINAL, { holding: true })]),
    });
    const app = await mount(power, width, height);
    await shows(app, "backupd");
    await shows(app, "Can keep this computer awake");
    assert.deepEqual(overflow(app, width, height), [], `${width}: controls inside`);
    if (pictures) app.screenshot(path.join(pictures, `power-awake-dark-${width}x${height}.png`));
    app.press({ focusId: `power:awake:${BACKUP.id}` });
    await app.until(() => power.state.settings.sleepBlockers.length === 1, "idle grant removed");
    await app.until(() => !app.texts().includes("backupd"), "row gone with its grant");
    app.destroy();
  }
});
console.log("[settings/power] ok");
