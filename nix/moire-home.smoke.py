#!/usr/bin/env python3
"""Run the actual mount-policy shell with private metadata/tool fixtures; no mounts."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

SOURCE = Path(__file__).with_name('moire-home.sh').resolve()
RUNTIME_COMMANDS = ('stat','findmnt','install','head','cmp','readlink','lsblk','blkid','e2fsck','systemd-mount','systemd-escape')

def volume_contract():
    vm=SOURCE.with_name('moire-vm.nix').read_text()
    assert 'volumeID = "MOIRE_AARCH64_P1";' in vm,'data-disk launches require the persistence-aware ISO marker'
    assert 'volumeID = "MOIRE_AARCH64";' not in vm,'old ISO marker must not authorize persistence'
    assert 'by-label/MOIRE_AARCH64' not in vm,'initrd label must derive from isoImage.volumeID'
    print(json.dumps({'scope':'source ISO format marker and generated-label contract; not ISO/native acceptance','volumeID':'MOIRE_AARCH64_P1','assertions':3,'actualExit':0},indent=2))

def runtime_contract(path):
    """Resolve every audited external command using ONLY the generated PATH."""
    entries=path.split(os.pathsep)
    assert entries and all(v.startswith('/nix/store/') and Path(v).is_dir() for v in entries),'expected actual declared Nix runtime directories'
    source=SOURCE.read_text(); found={}
    for command in RUNTIME_COMMANDS:
        assert command in source,'runtime inventory has an unused command: '+command
        executable=shutil.which(command,path=path)
        assert executable is not None,'missing declared runtime command: '+command
        found[command]=executable
    print(json.dumps({'scope':'actual executable resolution against generated helper PATH only; no host PATH fallback/device access','commands':found,'commandCount':len(found),'actualExit':0},indent=2))

def unit_contract(path):
    """Check actual evaluated units, including recovery isolation and ordering."""
    evaluated=json.loads(Path(path).read_text())
    units=evaluated['services']; home=units['moire-home.service']; session=units['moire-session.service']
    def values(unit,key):
        return [v for line in unit.splitlines() if line.startswith(key+'=') for v in line.split('=',1)[1].split()]
    assert 'systemd-tmpfiles-setup.service' in values(home,'After'),'prepare must follow ordinary tmpfiles'
    assert 'local-fs.target' in values(home,'After'),'prepare must follow local filesystems'
    assert 'systemd-tmpfiles-setup.service' not in values(home,'Before'),'prepare must not block ordinary tmpfiles'
    assert 'systemd-user-sessions.service' in values(home,'Before'),'prepare precedes login availability'
    assert 'moire-home.service' in values(session,'Requires'),'desktop must fail closed on prepare failure'
    assert 'moire-home.service' in values(session,'After'),'desktop must wait for prepare'
    post=values(home,'ExecStartPost')
    assert len(post)==3 and post[0].endswith('/bin/systemd-tmpfiles') and post[1]=='--create' and post[2].startswith('/nix/store/') and post[2].endswith('-moire-home-tmpfiles.conf'),post
    assert values(session,'EnvironmentFile')==['-/etc/moire/session.conf'],'root-edited optional configuration remains authoritative'
    assert evaluated['staticMounts']==[],'RAM boot must not pull static persistent mounts'
    module=SOURCE.with_suffix('.nix').read_text(); vm=SOURCE.with_name('moire-vm.nix').read_text()
    assert 'requiredBy = [ "moire-session.service" ];' in module,'only desktop Requires prepare'
    assert 'wantedBy = [ "systemd-user-sessions.service" ];' in module,'login startup only Wants prepare'
    assert '/home/moire/' not in vm,'home-only tmpfiles must not remain in global configuration'
    assert module.count('    d /home/moire/')==4 and module.count('    L /home/moire/')==1,'private home config must contain exactly the five original entries'
    assert '    L+ /home/moire/' not in module,'user botanical replacements must survive'
    assert 'users.users.moire.createHome = false;' in module,'activation must not pre-create mounted home'
    print(json.dumps({'scope':'evaluated Nix unit text and isolated home config contract; no systemd execution','unitAssertions':15,'actualExit':0,'units':str(path)},indent=2))

if len(sys.argv)>1:
    if sys.argv[1:] == ['--volume-contract']:
        volume_contract();sys.exit(0)
    assert len(sys.argv)==3 and sys.argv[1] in ('--units','--runtime-path'),'usage: moire-home.smoke.py [--units evaluated.json | --runtime-path generated_PATH]'
    if sys.argv[1]=='--units':unit_contract(sys.argv[2])
    else:runtime_contract(sys.argv[2])
    sys.exit(0)

STUB = r'''#!/usr/bin/env python3
import json,os,pathlib,sys
b=pathlib.Path(os.environ['MOIRE_HOME_FIXTURE']); p=json.loads((b/'plan.json').read_text()); n=pathlib.Path(sys.argv[0]).name; a=sys.argv[1:]
with (b/'calls.jsonl').open('a') as f: f.write(json.dumps([n,*a])+'\n')
s=json.loads((b/'mounts.json').read_text()); paths=p['paths']; canonical=paths['canonical']
def mapped(v):
 if v in s and v==paths['home']:return paths['storage']+'/home'
 if v in s and v==paths['config']:return paths['storage']+'/etc-moire'
 return v
if n=='readlink':print(os.path.realpath(a[-1]))
elif n=='stat':
 v=a[-1]; fmt=a[a.index('-Lc')+1]
 if fmt=='%F':print(p.get('deviceType','block special file') if v==canonical else 'regular file')
 elif fmt=='%t:%T':print(p.get('deviceIdentity','fc:10'))
 elif fmt=='%d:%i':print(p.get('badInode','bad') if v==p.get('wrongBind') else '1:'+mapped(v))
 else:print(p['attrs'].get(mapped(v),'0:0:755'))
elif n=='lsblk':print(p.get('serial','MOIREHOME'))
elif n=='blkid':print(p.get('type','ext4') if a[a.index('-s')+1]=='TYPE' else p.get('label','MOIRE_HOME'))
elif n=='e2fsck':
 assert not any(m['source']==canonical for m in s.values()),'fsck on mounted disk'
 sys.exit(p.get('fsckExit',0))
elif n=='systemd-escape':print(p['units'][a[-1]])
elif n=='systemd-mount':
 source,target=a[-2:];unit=p['units'][target]
 assert '--automount=no' in a and '--fsck=no' in a and '--no-ask-password' in a
 assert '--property=Before=moire-session.service' in a and '--property=TimeoutSec=15s' in a
 if target!=paths['storage']:
  assert '--type=none' in a and '--options=bind' in a
  escaped=p['units'][paths['storage']].replace('\\','\\\\')
  assert '--property=Requires='+escaped in a
  assert '--property=After='+escaped in a
 else:
  assert '--type=ext4' in a and '--options=rw,nosuid,nodev' in a
 assert source==(canonical if target==paths['storage'] else paths['storage']+('/home' if target==paths['home'] else '/etc-moire'))
 if unit==p.get('failUnit'):sys.exit(1)
 s[target]={'source':canonical if target==paths['storage'] else paths['storage']+('/home' if target==paths['home'] else '/etc-moire'),'type':'ext4','options':'rw,nosuid,nodev'}
 if target==p.get('wrongSource'):s[target]['source']=paths['other']
 if target==p.get('wrongType'):s[target]['type']='vfat'
 if target==p.get('readOnly'):s[target]['options']='ro'
 (b/'mounts.json').write_text(json.dumps(s))
elif n=='findmnt':
 target=a[a.index('--mountpoint')+1]
 if target not in s:sys.exit(1)
 if '-o' in a:print(' '.join(str(s[target][{'SOURCE':'source','FSTYPE':'type','OPTIONS':'options'}[k]]) for k in a[a.index('-o')+1].split(',')))
elif n=='install':
 pathlib.Path(a[-1]).mkdir(parents=True,exist_ok=True)
else:raise AssertionError(n)
'''
TOOLS = ['stat','readlink','lsblk','blkid','e2fsck','systemd-escape','systemd-mount','findmnt','install']
CASES=[]
def case(name, change=lambda p,b:None, requested=True, okay=True, checks=None):
    with tempfile.TemporaryDirectory(prefix='moire-home-policy-') as tmp:
        b=Path(tmp).resolve(); tools=b/'tools'; tools.mkdir(); stub=tools/'stub'; stub.write_text(STUB); stub.chmod(0o755)
        for name_tool in TOOLS:(tools/name_tool).symlink_to(stub)
        paths={k:str(b/k) for k in ['selector','device','canonical','storage','home','config','other']}
        Path(paths['canonical']).touch(); Path(paths['other']).touch(); Path(paths['device']).symlink_to(paths['canonical'])
        storage=Path(paths['storage']); (storage/'home').mkdir(parents=True); (storage/'etc-moire').mkdir()
        conf=storage/'etc-moire/session.conf'; conf.write_text('MOIRE_RENDERER=auto\n')
        if requested:Path(paths['selector']).write_bytes(b'1')
        attrs={paths['storage']:'0:0:755',paths['storage']+'/home':'1000:100:700',paths['storage']+'/etc-moire':'0:0:755',str(conf):'0:0:644'}
        p={'paths':paths,'attrs':attrs,'units':{paths['storage']:r'var-lib-moire\x2dpersist.mount',paths['home']:'fixture-home.mount',paths['config']:'fixture-config.mount'}}
        (b/'mounts.json').write_text('{}'); (b/'calls.jsonl').touch(); change(p,b); (b/'plan.json').write_text(json.dumps(p))
        original=conf.read_bytes() if conf.is_file() and not conf.is_symlink() else None
        env={**os.environ,'MOIRE_HOME_FIXTURE':str(b),'PATH':str(tools)+os.pathsep+os.environ['PATH']}
        run=subprocess.run([shutil.which('bash'),str(SOURCE),*[paths[k] for k in ['selector','device','storage','home','config']]],env=env,capture_output=True,text=True,timeout=5)
        assert (run.returncode==0)==okay,(name,run.returncode,run.stdout,run.stderr)
        calls=[json.loads(s) for s in (b/'calls.jsonl').read_text().splitlines()]
        assert not any(c[0] in ['mkfs','chown','chmod','mount','umount'] for c in calls),name
        if requested:
            assert not any(c[0]=='install' and c[-1].startswith(paths['storage']+'/') for c in calls),name
        else:
            assert not any(c[0] in ['blkid','e2fsck','systemd-mount'] for c in calls),name
        if original is not None:assert conf.read_bytes()==original,name
        if checks:checks(p,b,calls)
        CASES.append({'name':name,'actualExit':run.returncode,'expectedSuccess':okay})

def attr(k,v):return lambda p,b:p['attrs'].__setitem__(p['paths']['storage']+k,v)
def setting(k,v):return lambda p,b:p.__setitem__(k,v)
def mounted(p,b):
    s={p['paths']['storage']:{'source':p['paths']['canonical'],'type':'ext4','options':'rw'}}
    (b/'mounts.json').write_text(json.dumps(s))
def no_fsck(p,b,calls):assert not any(c[0]=='e2fsck' for c in calls)

def unsafe_symlink(p,b):
    v=Path(p['paths']['storage'])/'etc-moire/session.conf';v.unlink();v.symlink_to(p['paths']['other'])
def absent_conf(p,b): (Path(p['paths']['storage'])/'etc-moire/session.conf').unlink()

case('default RAM mode',requested=False)
case('absent opt-in ignores attached wrong-labelled disk',setting('label','WRONG'),requested=False)
case('explicit persistent home and config')
for payload in [b'',b'0',b'1\n',b'11',b'\x00',b'1'+b'x'*10000]:
    case('invalid selector '+repr(payload[:4]),lambda p,b,v=payload:Path(p['paths']['selector']).write_bytes(v),okay=False)
case('missing declared device',lambda p,b:Path(p['paths']['device']).unlink(),okay=False)
case('non-block device',setting('deviceType','regular file'),okay=False)
case('wrong serial',setting('serial','OTHER'),okay=False)
case('wrong filesystem',setting('type','xfs'),okay=False)
case('wrong label',setting('label','WRONG'),okay=False)
case('unclean filesystem requires recovery',setting('fsckExit',4),okay=False)
case('mount failure',setting('failUnit',r'var-lib-moire\x2dpersist.mount'),okay=False)
case('wrong mounted source',lambda p,b:p.__setitem__('wrongSource',p['paths']['storage']),okay=False)
case('wrong mounted filesystem',lambda p,b:p.__setitem__('wrongType',p['paths']['storage']),okay=False)
case('read-only storage',lambda p,b:p.__setitem__('readOnly',p['paths']['storage']),okay=False)
case('root directory unsafe ownership',attr('','1000:100:755'),okay=False)
case('root directory group writable',attr('','0:0:775'),okay=False)
case('home wrong ownership',attr('/home','0:0:700'),okay=False)
case('home group writable',attr('/home','1000:100:770'),okay=False)
case('home owner lacks write',attr('/home','1000:100:500'),okay=False)
case('root config directory other writable',attr('/etc-moire','0:0:757'),okay=False)
case('root config file symlink',unsafe_symlink,okay=False)
case('root config file unsafe owner',attr('/etc-moire/session.conf','1000:100:644'),okay=False)
case('root config file group writable',attr('/etc-moire/session.conf','0:0:664'),okay=False)
case('optional absent session.conf',absent_conf)
case('legitimate root chmod0600',attr('/etc-moire/session.conf','0:0:600'))
case('legitimate root directory0750',attr('/etc-moire','0:0:750'))
case('legitimate user home0755',attr('/home','1000:100:755'))
case('existing storage never fscked',mounted,checks=no_fsck)
case('wrong bind inode',lambda p,b:p.__setitem__('wrongBind',p['paths']['home']),okay=False)
case('read-only bind',lambda p,b:p.__setitem__('readOnly',p['paths']['home']),okay=False)
def full_mounted(p,b):
    mounted(p,b)
    mounts=json.loads((b/'mounts.json').read_text())
    for name,child in [('home','home'),('config','etc-moire')]:
        Path(p['paths'][name]).mkdir()
        mounts[p['paths'][name]]={'source':p['paths']['storage']+'/'+child,'type':'ext4','options':'rw'}
    (b/'mounts.json').write_text(json.dumps(mounts))
def no_new_mounts(p,b,calls):assert not any(c[0] in ['e2fsck','systemd-mount','install'] for c in calls)
def symlink_child(child):
    def change(p,b):
        v=Path(p['paths']['storage'])/child
        if child=='etc-moire':(v/'session.conf').unlink()
        v.rmdir();v.symlink_to(p['paths']['home'])
    return change
case('existing full layout is read-only idempotent',full_mounted,checks=no_new_mounts)
case('persistent home child symlink',symlink_child('home'),okay=False)
case('persistent config child symlink',symlink_child('etc-moire'),okay=False)
case('RAM home destination symlink',lambda p,b:Path(p['paths']['home']).symlink_to(p['paths']['other']),requested=False,okay=False)
case('optional config FIFO rejected without read',lambda p,b:(Path(p['paths']['storage']+'/etc-moire/session.conf').unlink(),os.mkfifo(p['paths']['storage']+'/etc-moire/session.conf')),okay=False)
case('second bind failure never falls back',setting('failUnit','fixture-config.mount'),okay=False)
case('read-only config bind',lambda p,b:p.__setitem__('readOnly',p['paths']['config']),okay=False)
print(json.dumps({'scope':'actual Bash policy with injected private metadata/tools; no device or mount access','cases':len(CASES),'sourceSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'results':CASES},indent=2))
