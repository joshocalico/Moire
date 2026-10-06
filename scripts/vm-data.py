#!/usr/bin/env python3
"""Create an independent data disk, or hold its write lease while QEMU runs."""
import argparse
import fcntl
import os
from pathlib import Path
import platform
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = b"""# Hand-editable Moire session environment. Read on the next session start.
# Keep system configuration here; user preferences belong in the home folder.
MOIRE_RENDERER=auto
MOIRE_EGL_PRESENT=auto
MOIRE_UI_ACCELERATION=auto
"""


def check_image(path):
    with open(path, 'rb') as image:
        image.seek(16 * 2048)
        descriptor = image.read(2048)
    if (len(descriptor) != 2048 or descriptor[:7] != b'\x01CD001\x01'
            or descriptor[40:72].rstrip(b' ') != b'MOIRE_AARCH64_P1'):
        raise ValueError('This ISO does not support persistent data. Use a P1 image; older fallback images support RAM mode only.')


def open_disk(path):
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError("Data disk must be a regular file.")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        superblock = os.pread(fd, 1024, 1024)
        if len(superblock) != 1024 or struct.unpack_from('<H', superblock, 56)[0] != 0xEF53:
            raise ValueError("Data disk must already contain ext4; nothing was formatted.")
        if superblock[120:136].rstrip(b'\0') != b'MOIRE_HOME':
            raise ValueError("Data disk must have filesystem label MOIRE_HOME.")
        return fd
    except BaseException:
        os.close(fd)
        raise


def create_disk(output, size_gib):
    # Do not resolve a final symlink: an existing link must also be refused.
    output = Path(os.path.abspath(output))
    if os.path.lexists(output):
        raise FileExistsError(f"Refusing existing output: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    if platform.system() == 'Linux' and shutil.which('mkfs.ext4', path='/usr/sbin:/sbin:/usr/bin:/bin'):
        formatter = 'local'
    elif platform.system() == 'Darwin' and shutil.which('prlctl'):
        formatter = 'parallels'
    else:
        raise RuntimeError("Formatting requires Linux e2fsprogs or the existing shared MoireDev Linux builder.")
    size = size_gib * 1024 ** 3
    # Keep Parallels arguments inside its established shared checkout, with no
    # caller-supplied filename parsed by its remote command bridge.
    staging_parent = ROOT / 'vm/data' if formatter == 'parallels' else output.parent
    staging_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.moire-data-', dir=staging_parent) as staging:
        directory = Path(staging)
        disk = directory / 'home.raw'
        fd = os.open(disk, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        try:
            os.ftruncate(fd, size)
            os.fsync(fd)
        finally:
            os.close(fd)
        (directory / 'session.conf').write_bytes(DEFAULT_CONFIG)
        if formatter == 'local':
            command = ['bash', str(ROOT / 'nix/format-vm-data.sh'), str(disk), str(size)]
        else:
            shared = Path('/media/psf/moire')
            guest_disk = shared / disk.resolve().relative_to(ROOT)
            command = ['prlctl', 'exec', os.environ.get('MOIRE_BUILD_VM', 'MoireDev'),
                       '/bin/bash', str(shared / 'nix/format-vm-data.sh'), str(guest_disk), str(size)]
        subprocess.run(command, check=True)
        fd = open_disk(disk)
        try:
            os.fsync(fd)
            # Atomic publication cannot replace an existing file or symlink.
            os.link(disk, output)
            directory_fd = os.open(output.parent, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            os.close(fd)
    print(f"Created {output} ({size_gib} GiB sparse raw ext4).")


def run_locked(path, command):
    if not command:
        raise ValueError('Expected QEMU command after --.')
    fd = open_disk(path)
    read_fd = None
    try:
        # QEMU retains the pre-opened disk itself. This avoids reopening a
        # changed pathname and keeps the inode lease if the supervisor dies.
        read_fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        before, after = os.fstat(fd), os.fstat(read_fd)
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            raise ValueError('Data-disk pathname changed before launch.')
        # QEMU probes read-only first, then opens the writable raw backend.
        child = subprocess.Popen(command + [
            '-add-fd', f'fd={fd},set=44,opaque=moire-home-rw',
            '-add-fd', f'fd={read_fd},set=44,opaque=moire-home-ro',
        ], pass_fds=(fd, read_fd))
        previous = {}
        def forward(signum, _frame):
            if child.poll() is None:
                child.send_signal(signum)
        for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            previous[sig] = signal.signal(sig, forward)
        try:
            return child.wait()
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
    finally:
        if read_fd is not None:
            os.close(read_fd)
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    create = commands.add_parser('create', help='Create a new disk; never overwrite an existing path.')
    create.add_argument('output', nargs='?', default=str(ROOT / 'vm/data/moire-home.raw'))
    create.add_argument('--size-gib', type=int, default=8)
    run = commands.add_parser('run', help='Hold an exclusive data-disk lease for a VM command.')
    run.add_argument('disk')
    run.add_argument('command', nargs=argparse.REMAINDER)
    check = commands.add_parser('check-image', help='Refuse persistence with an older RAM-only ISO.')
    check.add_argument('image')
    args = parser.parse_args()
    try:
        if args.action == 'create':
            if not 1 <= args.size_gib <= 256:
                parser.error('--size-gib must be between 1 and 256.')
            create_disk(args.output, args.size_gib)
            return 0
        if args.action == 'check-image':
            check_image(args.image)
            return 0
        command = args.command[1:] if args.command[:1] == ['--'] else args.command
        return run_locked(args.disk, command)
    except BlockingIOError:
        print('Data disk is already in use by another VM. Nothing was started.', file=sys.stderr)
        return 1
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Moire data disk: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
