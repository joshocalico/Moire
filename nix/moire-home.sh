#!/usr/bin/env bash
# Called by the early root unit with fixed paths and an immutable tool PATH.
set -euo pipefail

die() { echo "moire-home: $*" >&2; exit 1; }
[[ $# == 5 ]] || die "expected selector, device, storage, home and config paths"
selector=$1 device=$2 storage=$3 home=$4 config=$5

directory() {
  local path=$1 owner=$2 required=$3 attributes mode
  [[ -d "$path" && ! -L "$path" ]] || die "not a plain directory: $path"
  attributes=$(stat -Lc '%u:%g:%a' -- "$path") || die "cannot inspect $path"
  [[ ${attributes%:*} == "$owner" ]] || die "wrong directory ownership: $path"
  mode=$((8#${attributes##*:}))
  (( (mode & 0022) == 0 && (mode & required) == required )) ||
    die "unsafe directory permissions: $path"
}

unmounted() {
  if findmnt -n --mountpoint "$1" >/dev/null; then die "unexpected existing mount: $1"; fi
}

if [[ ! -e "$selector" && ! -L "$selector" ]]; then
  # No data disk is pulled into the boot transaction in the default RAM mode.
  unmounted "$storage"
  unmounted "$home"
  unmounted "$config"
  [[ ! -L "$home" && ! -L "$config" ]] || die "RAM destination is a symlink"
  install -d -m 0700 -o 1000 -g 100 -- "$home"
  install -d -m 0755 -o 0 -g 0 -- "$config"
  echo "moire-home: RAM home (persistent disk not requested)"
  exit 0
fi

[[ -f "$selector" ]] || die "invalid persistence selector"
head -c 2 -- "$selector" | cmp -s - <(printf '1') || die "selector must be exactly 1"
[[ -L "$device" ]] || die "persistent disk selector is missing"
canonical=$(readlink -f -- "$device") || die "cannot resolve persistent disk"
[[ $(stat -Lc '%F' -- "$canonical") == 'block special file' ]] || die "not a block device"
identity=$(stat -Lc '%t:%T' -- "$canonical")
[[ $(lsblk -dn -o SERIAL -- "$canonical") == MOIREHOME ]] || die "wrong disk serial"
[[ $(blkid -p -s TYPE -o value -- "$canonical") == ext4 ]] || die "disk must be ext4"
[[ $(blkid -p -s LABEL -o value -- "$canonical") == MOIRE_HOME ]] || die "wrong filesystem label"

verify_storage() {
  local source type options extra
  read -r source type options extra < <(findmnt -n -o SOURCE,FSTYPE,OPTIONS --mountpoint "$storage")
  [[ -n "$source" && -z "$extra" && "$type" == ext4 && ",$options," == *,rw,* ]] ||
    die "persistent storage is not a read-write ext4 mount"
  [[ $(readlink -f -- "$source") == "$canonical" ]] || die "wrong mounted source"
  [[ $(stat -Lc '%t:%T' -- "$canonical") == "$identity" ]] || die "disk identity changed"
  directory "$storage" 0:0 0500
}

if findmnt -n --mountpoint "$storage" >/dev/null; then
  verify_storage
else
  [[ ! -L "$storage" ]] || die "storage destination is a symlink"
  install -d -m 0755 -o 0 -g 0 -- "$storage"
  # Check without repairing, formatting or migrating. Never fsck a mounted disk.
  e2fsck -f -n -- "$canonical" || die "filesystem is not clean; recovery is required"
  [[ $(readlink -f -- "$device") == "$canonical" &&
     $(stat -Lc '%t:%T' -- "$canonical") == "$identity" ]] || die "disk identity changed"
  systemd-mount --no-ask-password --automount=no --fsck=no --type=ext4 --options=rw,nosuid,nodev \
    --property=Before=moire-session.service --property=TimeoutSec=15s \
    -- "$canonical" "$storage" || die "storage mount failed"
  verify_storage
fi

directory "$storage/home" 1000:100 0700
directory "$storage/etc-moire" 0:0 0500
if [[ -e "$storage/etc-moire/session.conf" || -L "$storage/etc-moire/session.conf" ]]; then
  file=$storage/etc-moire/session.conf
  [[ -f "$file" && ! -L "$file" ]] || die "session.conf must be a regular file"
  attributes=$(stat -Lc '%u:%g:%a' -- "$file")
  mode=$((8#${attributes##*:}))
  [[ ${attributes%:*} == 0:0 ]] && (( (mode & 0022) == 0 && (mode & 0400) == 0400 )) ||
    die "unsafe session.conf ownership or permissions"
fi

bind_directory() {
  local source=$1 target=$2 owner=$3 required=$4 type options extra volume_unit property_unit
  [[ ! -L "$target" ]] || die "bind destination is a symlink"
  if ! findmnt -n --mountpoint "$target" >/dev/null; then
    install -d -m 0755 -o 0 -g 0 -- "$target"
    volume_unit=$(systemd-escape --path --suffix=mount "$storage")
    # Property assignment parsing consumes one escape layer. Preserve the unit
    # name's literal backslashes; the mount path and unit name stay unchanged.
    property_unit=${volume_unit//\\/\\\\}
    systemd-mount --no-ask-password --automount=no --fsck=no --type=none --options=bind \
      "--property=Requires=$property_unit" \
      "--property=After=$property_unit" \
      --property=Before=moire-session.service --property=TimeoutSec=15s \
      -- "$source" "$target" || die "bind mount failed: $target"
  fi
  read -r type options extra < <(findmnt -n -o FSTYPE,OPTIONS --mountpoint "$target")
  [[ "$type" == ext4 && -z "$extra" && ",$options," == *,rw,* ]] || die "invalid bind mount: $target"
  [[ $(stat -Lc '%d:%i' -- "$source") == $(stat -Lc '%d:%i' -- "$target") ]] ||
    die "bind source does not match: $target"
  directory "$target" "$owner" "$required"
}

bind_directory "$storage/home" "$home" 1000:100 0700
bind_directory "$storage/etc-moire" "$config" 0:0 0500
echo "moire-home: persistent home and /etc/moire mounted; existing files preserved"
