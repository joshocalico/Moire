/** timedated → org.moire.TimeSettings1 → TimeSettingsClient, against a fake timedated. */
import assert from "node:assert/strict";
import { DbusRemoteError, variant, type DbusVariant } from "@moire/dbus";
import { SYSTEM_MANAGEMENT_BUS } from "@moire/system-management";
import {
  observeTimeSettings,
  parseZoneCatalog,
  searchTimeZones,
  type TimeSettingsClient,
} from "@moire/system-management/time-settings";
import { startPrivateBus, until } from "./private-bus.testing";
import { attachTimeSettings, createTimedatedAdapter, loadZoneCatalog } from "./time-settings";

const TIMEDATE = "org.freedesktop.timedate1";
const TIMEDATE_PATH = "/org/freedesktop/timedate1";

const ZONE1970 = [
  "# tzdb timezone descriptions, fixture",
  "#codes\tcoordinates\tTZ\tcomments",
  "GB,GG,IM,JE\t+513030-0000731\tEurope/London",
  "DE,DK,NO,SE,SJ\t+5230+01322\tEurope/Berlin\tmost of Germany",
  "CH,DE,LI\t+4723+00832\tEurope/Zurich\tBüsingen",
  "AR\t-3436-05827\tAmerica/Argentina/Buenos_Aires\tBuenos Aires (BA, CF)",
  "US\t+404251-0740023\tAmerica/New_York\tEastern (most areas)",
  "BR\t-2332-04637\tAmerica/Sao_Paulo\tBrazil (southeast: GO, DF, MG, ES, RJ, SP, PR, SC, RS)",
  "malformed line without tabs",
  "XX\t+0000+00000\t../../etc/passwd\tpath traversal",
].join("\n");
const ISO3166 =
  "GB\tBritain (UK)\nDE\tGermany\nCH\tSwitzerland\nAR\tArgentina\nUS\tUnited States\nBR\tBrazil\n";

// Catalog parsing and search, from a fixture.
const zones = parseZoneCatalog(ZONE1970, ISO3166);
assert.deepEqual(
  zones.map((zone) => zone.id),
  [
    "America/Argentina/Buenos_Aires",
    "America/New_York",
    "America/Sao_Paulo",
    "Europe/Berlin",
    "Europe/London",
    "Europe/Zurich",
    "UTC",
  ],
);
const buenosAires = zones.find((zone) => zone.id === "America/Argentina/Buenos_Aires")!;
assert.equal(buenosAires.city, "Buenos Aires");
assert.equal(buenosAires.subregion, "Argentina");
assert.equal(buenosAires.region, "America");
assert.deepEqual(buenosAires.countries, [{ code: "AR", name: "Argentina" }]);
const search = (query: string) => searchTimeZones(zones, query).map((zone) => zone.id);
assert.equal(search("zur")[0], "Europe/Zurich");
assert.equal(search("busingen")[0], "Europe/Zurich", "comment words match, accent-folded");
assert.equal(search("sao")[0], "America/Sao_Paulo");
assert.equal(search("germany")[0], "Europe/Berlin", "country names from iso3166.tab");
assert.deepEqual(search("de"), ["Europe/Berlin", "Europe/Zurich"], "country codes");
assert.equal(search("new york")[0], "America/New_York", "every word must match");
assert.deepEqual(search("eastern berlin"), []);
assert.equal(search("utc")[0], "UTC");
assert.equal(search("").length, zones.length);
assert.equal(loadZoneCatalog(["/nonexistent"]).length, 1, "UTC survives a missing tzdata");

// Fake timedated on a private bus standing in for the system bus.
const bus = await startPrivateBus("moire-timedated-smoke-");
let client: TimeSettingsClient | null = null;
try {
  const fixtureBus = await bus.connect();
  const props: Record<string, DbusVariant> = {
    Timezone: variant("s", "Europe/London"),
    LocalRTC: variant("b", false),
    CanNTP: variant("b", true),
    NTP: variant("b", true),
    NTPSynchronized: variant("b", false),
    TimeUSec: variant("t", 0n),
  };
  const calls: { member: string; body: unknown[] }[] = [];
  let deny = false;
  fixtureBus.exportObject(TIMEDATE_PATH, {
    name: "org.freedesktop.DBus.Properties",
    methods: {
      GetAll: {
        inSignature: "s",
        outSignature: "a{sv}",
        handler: ({ body }) => {
          assert.equal(body[0], TIMEDATE);
          calls.push({ member: "GetAll", body });
          return { body: [props] };
        },
      },
    },
  });
  const guard = () => {
    if (deny)
      throw new DbusRemoteError(
        "org.freedesktop.DBus.Error.InteractiveAuthorizationRequired",
        "polkit detail that must not reach the UI",
      );
  };
  fixtureBus.exportObject(TIMEDATE_PATH, {
    name: TIMEDATE,
    methods: {
      SetTimezone: {
        inSignature: "sb",
        outSignature: "",
        handler: ({ body }) => {
          calls.push({ member: "SetTimezone", body });
          guard();
          props.Timezone = variant("s", body[0]);
          return {};
        },
      },
      SetNTP: {
        inSignature: "bb",
        outSignature: "",
        handler: ({ body }) => {
          calls.push({ member: "SetNTP", body });
          guard();
          props.NTP = variant("b", body[0]);
          return {};
        },
      },
    },
  });
  assert.equal(await fixtureBus.requestName(TIMEDATE), 1);

  // The management service, as main.ts attaches it.
  const serviceBus = await bus.connect();
  assert.equal(await serviceBus.requestName(SYSTEM_MANAGEMENT_BUS), 1);
  const adapter = await createTimedatedAdapter({
    connect: () => bus.connect(),
    zones: () => zones,
  });
  const attached = attachTimeSettings(serviceBus, adapter);

  // Settings' client.
  const settingsBus = await bus.connect();
  client = await observeTimeSettings(settingsBus);
  const settings = client;
  await until(() => settings.state.kind === "ready", "time settings ready");
  const ready = () => {
    const state = settings.state;
    assert.equal(state.kind, "ready");
    if (state.kind !== "ready" || state.status.kind !== "ready") throw new Error("not ready");
    return state.status;
  };
  assert.equal(ready().timeZone, "Europe/London");
  assert.deepEqual(ready().ntp, { available: true, enabled: true, synchronized: false });

  // Catalog over the wire.
  const listed = await settings.timeZones();
  assert(listed.ok);
  assert.equal(listed.value.length, zones.length);
  assert.equal(searchTimeZones(listed.value, "zurich")[0]?.id, "Europe/Zurich");

  // Set the zone: never interactive, since Moire has no polkit agent.
  const set = await settings.setTimeZone("Europe/Berlin");
  assert.deepEqual(set, { ok: true, value: undefined });
  assert.deepEqual(calls.find((call) => call.member === "SetTimezone")?.body, [
    "Europe/Berlin",
    false,
  ]);
  await until(() => ready().timeZone === "Europe/Berlin", "zone change published");

  // Unknown zones stop in the service before timedated.
  const before = calls.length;
  const unknown = await settings.setTimeZone("Mars/Olympus_Mons");
  assert(!unknown.ok && unknown.code === "invalid");
  const malformed = await settings.setTimeZone("../../etc/passwd");
  assert(!malformed.ok && malformed.code === "invalid");
  assert.equal(calls.slice(before).filter((call) => call.member === "SetTimezone").length, 0);

  // Network time.
  assert.deepEqual(await settings.setNetworkTime(false), { ok: true, value: undefined });
  assert.deepEqual(calls.find((call) => call.member === "SetNTP")?.body, [false, false]);
  await until(() => !ready().ntp.enabled, "ntp change published");

  // Polkit refusal comes back as a value with our own text.
  deny = true;
  const denied = await settings.setTimeZone("Europe/Zurich");
  assert(!denied.ok);
  assert.equal(denied.code, "permission");
  assert.doesNotMatch(denied.message, /polkit detail/);
  deny = false;

  // Sync status is re-read on demand.
  props.NTPSynchronized = variant("b", true);
  assert((await settings.refresh()).ok);
  await until(() => ready().ntp.synchronized, "refresh re-reads timedated");

  // timedated gone: reads say unavailable, setters fail as values.
  fixtureBus.close();
  assert((await settings.refresh()).ok);
  await until(() => {
    const state = settings.state;
    return state.kind === "ready" && state.status.kind === "unavailable";
  }, "timedated unavailable");
  const gone = await settings.setNetworkTime(true);
  assert(!gone.ok && gone.code === "unavailable");

  await attached.dispose();
  console.log("[time-settings.smoke] ok");
} finally {
  await client?.dispose();
  await bus.close();
}
