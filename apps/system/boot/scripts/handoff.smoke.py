"""Actual handoff orchestration, with manager/admission fixtures.
Native secure record and mandatory systemd gate checks remain separate.
"""
import json
import os
import pathlib
import subprocess
import tempfile

script = pathlib.Path(__file__).with_name('handoff.sh').resolve()
expected = '1234567890abcdef1234567890abcdef'
controller = r'''#!/usr/bin/env python3
import json,os,pathlib,sys
b=pathlib.Path(os.environ['HANDOFF_FIXTURE'])
with (b/'calls').open('a') as f:f.write(json.dumps(sys.argv[1:])+'\n')
mode=os.environ['HANDOFF_CASE']
if sys.argv[1]=='stop':
 (b/'stopped').touch();sys.exit(1 if mode=='stop-timeout' else 0)
if sys.argv[1]=='start':
 assert (b/'checked').exists(), 'desktop start before admission'
 (b/'started').touch();sys.exit(0)
assert sys.argv[1:]==['show','moire-boot.service','--property=InvocationID','--value']
if mode=='manager-failure':sys.exit(1)
print('' if mode in ['collected','not-invoked','missing-records'] else ('invalid' if mode=='invalid-id' else os.environ['EXPECTED']))
'''
cleanup = r'''#!/usr/bin/env python3
import json,os,pathlib,sys
b=pathlib.Path(os.environ['HANDOFF_FIXTURE']); mode=os.environ['HANDOFF_CASE']
assert os.environ['INVOCATION_ID']=='e'*32, 'handoff substituted its own manager identity'
assert os.environ['MOIRE_BOOT_UNIT']=='moire-boot.service'
with (b/'calls').open('a') as f:f.write(json.dumps(sys.argv[1:])+'\n')
if sys.argv[1:]==['--admission-check','--checkpoint']:
 if mode=='missing-records':sys.exit(1)
 print('not-invoked' if mode=='not-invoked' else os.environ['EXPECTED']);sys.exit(0)
assert sys.argv[1:]==['--admission-check','--expect','not-invoked' if mode=='not-invoked' else os.environ['EXPECTED']]
assert (b/'stopped').exists(), 'admission before stop completed'
(b/'checked').touch()
sys.exit(1 if mode in ['changed-id','still-active','bad-release'] else 0)
'''
cases = ['success', 'stop-timeout', 'collected', 'not-invoked', 'missing-records',
         'invalid-id', 'manager-failure', 'changed-id', 'still-active', 'bad-release']
for case in cases:
    with tempfile.TemporaryDirectory(prefix='moire-handoff-') as directory:
        base = pathlib.Path(directory)
        for name, source in [('controller', controller), ('cleanup', cleanup)]:
            target = base/name
            target.write_text(source)
            target.chmod(0o700)
        env = {**os.environ, 'HANDOFF_FIXTURE': directory, 'HANDOFF_CASE': case,
               'MOIRE_SYSTEMCTL': str(base/'controller'), 'MOIRE_BOOT_CLEANUP': str(base/'cleanup'),
               'MOIRE_BOOT_UNIT': 'moire-boot.service', 'EXPECTED': expected,
               'INVOCATION_ID': 'e'*32}
        result = subprocess.run(['bash', str(script)], env=env, capture_output=True, text=True, timeout=5)
        permitted = case in ['success', 'stop-timeout', 'collected', 'not-invoked']
        assert (result.returncode == 0) == permitted, (case, result.stdout, result.stderr)
        assert (base/'started').exists() == permitted, case
        if case in ['missing-records', 'invalid-id', 'manager-failure']:
            assert not (base/'stopped').exists(), case
        print(json.dumps({'case': case, 'exit': result.returncode, 'desktopStarted': permitted,
                          'scope': 'actual shell orchestration; admission/manager fixtures'}))
