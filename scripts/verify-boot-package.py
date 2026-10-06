#!/usr/bin/env python3
"""Bind a compiled boot output to frozen source and record its runtime hashes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--package',required=True)
parser.add_argument('--evidence',required=True)
parser.add_argument('--builder',default=os.environ.get('MOIRE_BUILD_VM','MoireDev'))
parser.add_argument('--reuse-collector',action='store_true',help='Read preserved collector output for the same exact package')
parser.add_argument('--allow-unused-bytecode',action='store_true',help='Audit untracked Python caches only when absent from compiled inputs/output and runtime closure')
args=parser.parse_args()
assert re.fullmatch(r'/nix/store/[a-z0-9]{32}-moire-boot-0\.0\.0',args.package)
root=Path(__file__).resolve().parents[1]
evidence=(root/args.evidence).resolve()
expected=json.loads((evidence/'host-source-sha256.json').read_text())
script='''#!/usr/bin/env bash
set -euo pipefail
export PATH=/nix/var/nix/profiles/default/bin:$PATH
python3 - <<'GUEST'
import hashlib,json,pathlib,subprocess
package=pathlib.Path(PACKAGE_VALUE)
drv=subprocess.check_output(['nix-store','--query','--deriver',str(package)],text=True).strip()
derivation=json.loads(subprocess.check_output(['nix','--extra-experimental-features','nix-command flakes','derivation','show',drv],text=True))
source=pathlib.Path(derivation[drv]['env']['src'])
def sha(file):
 with file.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
inputs={str(p.relative_to(source)):sha(p) for p in source.rglob('*') if p.is_file() and not p.is_symlink()}
outputs={str(p.relative_to(package)):sha(p) for p in package.rglob('*') if p.is_file() and not p.is_symlink()}
closure=json.loads(subprocess.check_output(['nix','--extra-experimental-features','nix-command flakes','path-info','--json','--recursive',str(package)],text=True))
manifest=json.loads((package/'lib/moire-boot/bundle-manifest.json').read_text())
print(json.dumps({'package':str(package),'derivationPath':drv,'derivation':derivation,'sourceStorePath':str(source),'inputSha256':inputs,'outputSha256':outputs,'bundleManifest':manifest,'closure':closure,'scope':'compiled artifact/source only; bind actual ISO unit/package hashes during native boot'}))
GUEST
'''.replace('PACKAGE_VALUE',repr(args.package))
collector=evidence/'verify-boot-guest.sh'
if args.reuse_collector:
    data=json.loads((evidence/'boot-provenance.stdout.log').read_text())
else:
    assert not collector.exists(),'Existing evidence is preserved'
    collector.write_text(script)
    guest=Path('/media/psf/moire')/collector.relative_to(root)
    run=subprocess.run(['prlctl','exec',args.builder,'bash',str(guest)],capture_output=True,text=True,timeout=120)
    (evidence/'boot-provenance.stdout.log').write_text(run.stdout)
    (evidence/'boot-provenance.stderr.log').write_text(run.stderr)
    run.check_returncode()
    data=json.loads(run.stdout)
assert data['package']==args.package,'Collector belongs to another package'
unmatched={name:value for name,value in data['inputSha256'].items() if expected.get(name)!=value}
ignored={}
if unmatched and args.allow_unused_bytecode:
    manifest=data.get('bundleManifest')
    assert manifest is not None,'Compiled input manifest required for bytecode audit'
    closure=data['closure']
    closure_paths={item['path'] for item in closure} if isinstance(closure,list) else set(closure)
    assert data['sourceStorePath'] not in closure_paths,'Runtime closure retains input source'
    for name,value in unmatched.items():
        assert name not in expected and '__pycache__' in Path(name).parts and Path(name).suffix=='.pyc','Changed or unknown runtime source is not an unused cache'
        assert not any(item['name']==name or item['name'].endswith('/'+name) for item in manifest['inputs']),'Bytecode is a compiled input'
        assert not any(Path(output).suffix=='.pyc' or '__pycache__' in Path(output).parts for output in data['outputSha256']),'Bytecode entered runtime output'
        ignored[name]=value
assert all(name in ignored or (name in expected and value==expected[name]) for name,value in data['inputSha256'].items()),'Boot input differs from frozen source'
assert all(name in ignored or hashlib.sha256((root/name).read_bytes()).hexdigest()==value for name,value in data['inputSha256'].items()),'Boot runtime source changed during build'
data['matchedFrozenInputFiles']=len(data['inputSha256'])-len(ignored)
data['unusedUnfrozenBytecodeInputs']=ignored
(evidence/'boot-provenance.json').write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps({'package':args.package,'matchedFrozenInputFiles':data['matchedFrozenInputFiles'],'outputFiles':len(data['outputSha256']),'nativeAcceptance':False}))
