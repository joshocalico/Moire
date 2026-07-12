#!/usr/bin/env bash
# Remote guest bootstrap over SSH (run from Mac host).
set -euo pipefail
HOST="${MOIRE_SSH_HOST:-10.211.55.17}"
USER="${MOIRE_SSH_USER:-moire}"
PASS="${MOIRE_SSH_PASS:-Moire-dev-2026}"

remote() {
  expect <<EOF
set timeout 600
spawn ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null ${USER}@${HOST} {$1}
expect {
  -re "(?i)password:" { send "${PASS}\r" }
  timeout { exit 1 }
}
expect {
  -re {\$ } {}
  eof {}
}
EOF
}

# Use ssh with a here-doc via expect for multi-line
expect <<'EOF'
set timeout 900
set host "10.211.55.17"
set user "moire"
set pass "Moire-dev-2026"

spawn ssh -tt -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null $user@$host
expect {
  -re "(?i)password:" { send "$pass\r" }
}
expect -re {\$ }

send "sudo -S bash -lc 'set -euo pipefail\n\
usermod -aG video,input moire\n\
apt-get update\n\
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  build-essential pkg-config curl ca-certificates git \
  libdrm-dev libgbm-dev libegl-dev libgles2-mesa-dev \
  libinput-dev libxkbcommon-dev libseat-dev seatd \
  wayland-protocols libwayland-dev \
  dbus dbus-user-session \
  nautilus gvfs gvfs-backends foot libreoffice xwayland \
  adwaita-icon-theme hicolor-icon-theme mesa-utils \
  linux-tools-generic\n\
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -\n\
DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs\n\
corepack enable\n\
corepack prepare pnpm@9.15.0 --activate\n\
echo DONE_APT\n' <<'SUDOPASS'\nMoire-dev-2026\nSUDOPASS\r"

expect {
  -re "DONE_APT" { puts "APT_OK" }
  -re "password for" { send "$pass\r"; exp_continue }
  timeout { puts "APT_TIMEOUT"; exit 1 }
}
expect -re {\$ }
send "exit\r"
expect eof
EOF
