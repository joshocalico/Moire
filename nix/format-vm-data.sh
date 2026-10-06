#!/usr/bin/env bash
# Format only a fresh, privately staged regular file created by vm-data.py.
set -euo pipefail
export PATH="/usr/sbin:/sbin:/usr/bin:/bin:$PATH"
[[ $# == 2 ]] || { echo 'Expected staged disk and its size in bytes.' >&2; exit 1; }
disk="$1"
size="$2"
parent="$(dirname "$disk")"
[[ "$(basename "$parent")" == .moire-data-* && "$(basename "$disk")" == home.raw ]] || exit 1
[[ -d "$parent" && ! -L "$parent" && -f "$disk" && ! -L "$disk" ]] || exit 1
[[ "$(stat -c %h "$disk")" == 1 && "$(stat -c %s "$disk")" == "$size" ]] || exit 1
[[ -f "$parent/session.conf" && ! -L "$parent/session.conf" ]] || exit 1
mkfs.ext4 -q -F -L MOIRE_HOME -m 0 \
  -E root_owner=0:0,lazy_itable_init=0,lazy_journal_init=0 "$disk"
cat > "$parent/layout.debugfs" <<'EOF'
set_inode_field / mode 040755
mkdir /home
set_inode_field /home uid 1000
set_inode_field /home gid 100
set_inode_field /home mode 040700
mkdir /etc-moire
set_inode_field /etc-moire mode 040755
EOF
# debugfs receives a generated path inside the private staging directory.
[[ "$parent" != *'"'* && "$parent" != *$'\n'* && "$parent" != *$'\r'* ]] || exit 1
printf 'write "%s/session.conf" /etc-moire/session.conf\n' "$parent" >> "$parent/layout.debugfs"
printf 'set_inode_field /etc-moire/session.conf mode 0100644\n' >> "$parent/layout.debugfs"
debugfs -w -f "$parent/layout.debugfs" "$disk"
e2fsck -fn "$disk"
