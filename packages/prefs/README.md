# Moire preferences

The existing user profile lives at `$XDG_CONFIG_HOME/moire/settings.json`, or
`~/.config/moire/settings.json` when XDG_CONFIG_HOME is absent. Reduced motion is a
boolean named `reducedMotion`. Missing or malformed values default to false.
Loading an older valid profile retains its existing recognized fields.

`Application.setSessionReducedMotion(value)` persists this field without applying
GTK, audio or renderer settings. The caller receives save failures through the
returned promise. The greeter and Settings expose that failure in their existing
preference feedback. Already-running Moire Applications consume changes through
the existing preference watcher, and newly started Applications load the saved
value. System widget motion durations become zero when reduced motion is enabled.
Application-specific personalization overrides retain their existing precedence.

`updateSettings(patch)` reads the latest stored profile and updates only the
caller's fields. Use it for a control that owns one preference instead of saving
a stale full UI snapshot. It atomically replaces the JSON file so readers do not
observe a partially written profile. This is not concurrent compare-and-swap or a
cross-process transaction lock. Simultaneous read/modify/write operations can
still race, and `saveSettings(fullProfile)` retains full-profile replacement
semantics. No lock or background preference service is introduced.

The motion field participates in watcher signatures independently of theme
changes. File inode, nanosecond mtime and size detect atomic replacements even
when millisecond mtimes match. Decorative motion still requires its own verified
renderer and visibility policy. Persisting reduced motion does not certify GPU
execution or enable the currently static welcome/boot artwork.

Preference persistence uses the existing user storage. On an immutable live image
with a RAM user profile, restarting an application retains this setting within
that running image; reboot persistence remains limited by that storage setup.

Run the isolated checks from the repository or installed full-package source root:

```sh
node node_modules/.bin/tsx packages/prefs/tests/reduced-motion.smoke.ts
node node_modules/.bin/tsx packages/prefs/tests/consumers.smoke.tsx
```

The first test runs three independent real headless Application child processes
and covers load, live changes, restart, actual Window theme propagation and save
failure. The second exercises production Settings controls and actual Window
greeter keyboard save/error behavior. Both use disposable private HOME/XDG
fixtures. The Settings fixture prevents optional host tools from resolving; no
GTK service, audio service, graphics device or native session is exercised.
