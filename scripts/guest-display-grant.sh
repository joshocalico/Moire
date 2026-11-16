# Sourced (not run) by the guest display scripts, as root. Grants this shell and what it starts
# the display mode and layout methods of org.moire.Display1, which otherwise answer only
# Settings, for the length of the run. Only an image that enables it honours the grant
# (moire.testing.displayControl; apps/system/compositor/src/display-access.ts).
#
# The grant names this root shell by pid and start time in a root-owned file. No user process
# can write it, or become a descendant of this shell, so nothing else gains the methods.

DISPLAY_GRANT_ENABLED=/etc/moire/testing/display-control
DISPLAY_GRANT_DIR=/run/moire-test
DISPLAY_GRANT="$DISPLAY_GRANT_DIR/display-control"

if [[ "$EUID" -ne 0 ]]; then
  echo "Run as root (prlctl exec does): the display grant is root's" >&2
  exit 1
fi
if [[ ! -e "$DISPLAY_GRANT_ENABLED" ]]; then
  echo "Display changes from scripts are off: this is not a test image." >&2
  echo "NixOS test image: moire.testing.displayControl = true (nix/moire-testing.nix)." >&2
  echo "Ubuntu dev VM: sudo install -D -m 0444 /dev/null $DISPLAY_GRANT_ENABLED" >&2
  exit 1
fi

# Field 22 of /proc/<pid>/stat, the start time; read past the comm's closing parenthesis.
DISPLAY_GRANT_LINE="$$ $(sed 's/.*) //' "/proc/$$/stat" | cut -d' ' -f20)"
install -d -o root -g root -m 0755 "$DISPLAY_GRANT_DIR"
display_grant_tmp="$(mktemp "$DISPLAY_GRANT_DIR/.display-control.XXXXXX")"
printf '%s\n' "$DISPLAY_GRANT_LINE" >"$display_grant_tmp"
chmod 0644 "$display_grant_tmp"
mv -f "$display_grant_tmp" "$DISPLAY_GRANT"

# Remove the grant if it is still this run's (another run may have replaced it).
release_display_grant() {
  if [[ "$(cat "$DISPLAY_GRANT" 2>/dev/null)" == "$DISPLAY_GRANT_LINE" ]]; then
    rm -f "$DISPLAY_GRANT"
  fi
}
trap release_display_grant EXIT
