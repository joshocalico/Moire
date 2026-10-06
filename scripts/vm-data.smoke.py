#!/usr/bin/env python3
"""Host boundary checks; synthetic superblocks are not ext4 acceptance proof."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('vm_data', Path(__file__).with_name('vm-data.py'))
data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(data)


def synthetic_disk(path):
    header = bytearray(2048)
    header[1080:1082] = b'\x53\xef'
    header[1144:1154] = b'MOIRE_HOME'
    path.write_bytes(header)


class Boundaries(unittest.TestCase):
    def test_existing_file_and_symlink_are_never_formatted(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'user-data.raw'
            path.write_bytes(b'precious data')
            link = Path(temporary) / 'link.raw'
            link.symlink_to(path)
            with patch.object(data.subprocess, 'run') as formatter:
                for existing in (path, link):
                    with self.assertRaises(FileExistsError):
                        data.create_disk(existing, 1)
                formatter.assert_not_called()
            self.assertEqual(path.read_bytes(), b'precious data')

    def test_invalid_disk_and_symlink_do_not_start_a_child(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'wrong.raw'
            path.write_bytes(b'not a filesystem')
            link = Path(temporary) / 'link.raw'
            link.symlink_to(path)
            with patch.object(data.subprocess, 'Popen') as child:
                with self.assertRaises(ValueError):
                    data.run_locked(path, ['false'])
                with self.assertRaises(OSError):
                    data.run_locked(link, ['false'])
                child.assert_not_called()

    def test_failure_leaves_no_published_disk(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'new.raw'
            with patch.object(data.platform, 'system', return_value='Linux'), \
                 patch.object(data.shutil, 'which', return_value='/usr/sbin/mkfs.ext4'), \
                 patch.object(data.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'formatter')):
                with self.assertRaises(subprocess.CalledProcessError):
                    data.create_disk(path, 1)
            self.assertEqual(list(Path(temporary).iterdir()), [])

    def test_racing_output_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'new.raw'
            def racing_formatter(command, **_):
                synthetic_disk(Path(command[-2]))
                path.write_bytes(b'another creator won')
            with patch.object(data.platform, 'system', return_value='Linux'), \
                 patch.object(data.shutil, 'which', return_value='/usr/sbin/mkfs.ext4'), \
                 patch.object(data.subprocess, 'run', side_effect=racing_formatter):
                with self.assertRaises(FileExistsError):
                    data.create_disk(path, 1)
            self.assertEqual(path.read_bytes(), b'another creator won')
            self.assertEqual(list(Path(temporary).iterdir()), [path])

    def test_second_process_cannot_write_same_disk_and_lease_releases(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'data.raw'
            ready = Path(temporary) / 'ready'
            synthetic_disk(path)
            script = 'import pathlib,sys,time; pathlib.Path(sys.argv[1]).touch(); time.sleep(30)'
            first = subprocess.Popen([sys.executable, str(spec.origin), 'run', str(path), '--',
                                      sys.executable, '-c', script, str(ready)],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 5
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists(), 'first child never acquired its lease')
                second = subprocess.run([sys.executable, str(spec.origin), 'run', str(path), '--',
                                         sys.executable, '-c', 'raise SystemExit(97)'], capture_output=True)
                self.assertEqual(second.returncode, 1)
                self.assertIn(b'already in use', second.stderr)
            finally:
                first.terminate()
                first.communicate(timeout=5)
            fd = data.open_disk(path)
            os.close(fd)

    def test_launcher_preserves_paths_and_ram_mode(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            qemu = directory / 'fake-qemu'
            captured = directory / 'args.json'
            qemu.write_text('#!' + sys.executable + '\nimport json,os,sys\n'
                            'open(os.environ["CAPTURE"], "w").write(json.dumps(sys.argv[1:]))\n')
            qemu.chmod(0o700)
            image = directory / 'system, image.iso'
            image.touch()
            firmware = directory / 'firmware.fd'
            firmware.touch()
            disk = directory / 'home, data.raw'
            synthetic_disk(disk)
            env = dict(os.environ, MOIRE_QEMU=str(qemu), MOIRE_QEMU_FIRMWARE=str(firmware), CAPTURE=str(captured))
            launcher = str(data.ROOT / 'scripts/run-vm.sh')
            subprocess.run(['bash', launcher, str(image)], env=env, check=True)
            args = json.loads(captured.read_text())
            self.assertIn('file=' + str(image).replace(',', ',,') + ',format=raw,if=none,id=cdrom,media=cdrom,readonly=on', args)
            self.assertNotIn('-fw_cfg', args)
            # Old media must fail before starting QEMU in persistent mode.
            captured.unlink()
            old = subprocess.run(['bash', launcher, str(image), '--data', str(disk)], env=env, capture_output=True)
            self.assertEqual(old.returncode, 1)
            self.assertIn(b'does not support persistent data', old.stderr)
            self.assertFalse(captured.exists())
            header = bytearray(18 * 2048)
            header[32768:32775] = b'\x01CD001\x01'
            header[32808:32840] = b'MOIRE_AARCH64_P1'.ljust(32, b' ')
            image.write_bytes(header)
            subprocess.run(['bash', launcher, str(image), '--data', str(disk)], env=env, check=True)
            args = json.loads(captured.read_text())
            self.assertIn('driver=file,node-name=homefile,filename=/dev/fdset/44,locking=off', args)
            self.assertIn('driver=raw,node-name=home,file=homefile', args)
            self.assertIn('-add-fd', args)
            self.assertIn('virtio-blk-pci,drive=home,serial=MOIREHOME', args)
            self.assertIn('name=opt/moire/home-disk,string=1', args)

    def test_child_retains_lease_if_supervisor_is_killed(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'data.raw'
            ready = Path(temporary) / 'pid'
            synthetic_disk(path)
            script = 'import os,pathlib,sys,time; pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); time.sleep(30)'
            supervisor = subprocess.Popen([sys.executable, str(spec.origin), 'run', str(path), '--',
                                           sys.executable, '-c', script, str(ready)],
                                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            child_pid = None
            try:
                deadline = time.monotonic() + 5
                while not ready.exists() and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists())
                child_pid = int(ready.read_text())
                supervisor.kill()
                supervisor.wait(timeout=5)
                with self.assertRaises(BlockingIOError):
                    data.open_disk(path)
            finally:
                if supervisor.poll() is None:
                    supervisor.terminate()
                    supervisor.wait(timeout=5)
                if child_pid is not None:
                    os.kill(child_pid, 15)
            deadline = time.monotonic() + 5
            while True:
                try:
                    fd = data.open_disk(path)
                    os.close(fd)
                    break
                except BlockingIOError:
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.01)


if __name__ == '__main__':
    unittest.main()
