/** Notification policy: rule keys, normalisation and the Do not disturb schedule. */
import assert from "node:assert/strict";
import {
  DEFAULT_NOTIFICATION_RULE,
  dndScheduleActive,
  dndScheduleEnd,
  normalizeDndSchedule,
  normalizeNotificationRules,
  notificationAppKey,
  notificationRuleFor,
  withNotificationRule,
} from "./notifications";

// Keys: the desktop entry (without .desktop) wins over the app name.
assert.equal(notificationAppKey("org.moire.Files.desktop", "Files"), "org.moire.Files");
assert.equal(notificationAppKey("", " Files "), "Files");

// Rules keep only what differs from the default and survive hostile keys.
// Parsed, as settings.json is, so "__proto__" is an own key rather than the prototype.
const rules = normalizeNotificationRules(
  JSON.parse(`{
    "Files": { "allow": true, "banners": false },
    "Calendar": { "allow": true, "banners": true, "sound": true, "history": true },
    "": { "allow": false },
    "__proto__": { "allow": false },
    "Bad": "nope"
  }`),
);
assert.deepEqual(Object.keys(rules).sort(), ["Files", "__proto__"]);
assert.equal(notificationRuleFor(rules, "Files").banners, false);
assert.equal(notificationRuleFor(rules, "Files").sound, true);
assert.equal(notificationRuleFor(rules, "toString"), DEFAULT_NOTIFICATION_RULE);
assert.deepEqual(normalizeNotificationRules(null), {});
const many = Object.fromEntries(
  Array.from({ length: 400 }, (_, i) => [`app${i}`, { allow: false }]),
);
assert.equal(Object.keys(normalizeNotificationRules(many)).length, 256);

// Changing a rule back to the default removes it.
const quiet = withNotificationRule({}, "Files", { sound: false });
assert.deepEqual(quiet, { Files: { allow: true, banners: true, sound: false, history: true } });
assert.deepEqual(withNotificationRule(quiet, "Files", { sound: true }), {});

// Schedule normalisation.
assert.deepEqual(normalizeDndSchedule({ enabled: true, from: "25:00", to: "06:30" }), {
  enabled: true,
  from: "22:00",
  to: "06:30",
});
assert.equal(normalizeDndSchedule("x").enabled, false);

const at = (hours: number, minutes = 0) => new Date(2026, 9, 10, hours, minutes);
const overnight = { enabled: true, from: "22:00", to: "07:00" };
assert.equal(dndScheduleActive(overnight, at(23)), true);
assert.equal(dndScheduleActive(overnight, at(6, 59)), true);
assert.equal(dndScheduleActive(overnight, at(7)), false, "the end is exclusive");
assert.equal(dndScheduleActive(overnight, at(22)), true, "the start is inclusive");
assert.equal(dndScheduleActive(overnight, at(12)), false);
assert.equal(dndScheduleActive({ ...overnight, enabled: false }, at(23)), false);
const daytime = { enabled: true, from: "09:00", to: "17:30" };
assert.equal(dndScheduleActive(daytime, at(12)), true);
assert.equal(dndScheduleActive(daytime, at(18)), false);
assert.equal(dndScheduleActive({ enabled: true, from: "08:00", to: "08:00" }, at(3)), true);

// The window's end: tomorrow morning from late evening, this morning after midnight.
assert.equal(dndScheduleEnd(overnight, at(23)), new Date(2026, 9, 11, 7).getTime());
assert.equal(dndScheduleEnd(overnight, at(2)), at(7).getTime());
assert.equal(dndScheduleEnd(overnight, at(12)), null);

console.log("[prefs] notification rules and Do not disturb schedule passed");
