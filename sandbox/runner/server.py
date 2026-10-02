"""Local privileged broker. Its Unix socket is a capability, never a TCP API."""
import hashlib
import http.server
import json
import os
import re
import shutil
import socketserver
import socket
import stat
import threading
import time
import uuid
from pathlib import Path
from .runtime import control, validate_request, execute
from . import limits

CONFIG = Path('/etc/sawot-runner.json')
ROOT = Path('/var/lib/sawot-runner/jobs')
SOCKET = '/run/sawot-runner/runner.sock'

def valid_id(value):
    return isinstance(value, str) and re.fullmatch('[0-9a-f]{32}', value) is not None

def config():
    info = CONFIG.stat()
    if info.st_uid != 0 or info.st_mode & 0o022: raise ValueError('Unsafe runner configuration')
    value = json.loads(CONFIG.read_text())
    if set(value) != {'image', 'runscSha256'}: raise ValueError('Invalid configuration')
    if not re.fullmatch('sha256:[0-9a-f]{64}', value['image']): raise ValueError('Image must be pinned')
    return value

def fingerprint(cfg, daemon=None):
    if daemon is None: daemon=json.loads(control(['/usr/bin/docker','info','--format','{{json .}}']).stdout)
    identity={k:daemon.get(k) for k in ('ID','DockerRootDir','Driver','SecurityOptions','CgroupDriver','CgroupVersion','KernelVersion','ServerVersion','Runtimes')}
    digest = hashlib.sha256(json.dumps({'config':cfg,'daemon':identity}, sort_keys=True).encode())
    base=Path(__file__).parent.parent
    paths=list((base/'runner').glob('*.py'))+list((base/'systemd').glob('*.service'))+list((base/'tests').glob('test_live_*.py'))
    for path in sorted(paths): digest.update(path.read_bytes())
    digest.update(Path('/proc/sys/kernel/random/boot_id').read_bytes())
    return digest.hexdigest()

def ready(cfg=None, *, require_proof=True):
    try:
        cfg = config() if cfg is None else cfg
        image = cfg['image']
        info = json.loads(control(['/usr/bin/docker','info','--format','{{json .}}']).stdout)
        runtime = info['Runtimes']['runsc']
        path = Path(runtime['path'])
        if not path.is_absolute(): raise ValueError('Use an absolute runsc path')
        st = path.stat()
        if st.st_uid != 0 or st.st_mode & 0o022 or hashlib.sha256(path.read_bytes()).hexdigest() != cfg['runscSha256']:
            raise ValueError('Runtime identity changed')
        if info['CgroupVersion'] != '2': raise ValueError('cgroup v2 required')
        control(['/usr/bin/docker','image','inspect',image])
        unit=control(['/usr/bin/systemctl','cat','sawot-job@.service']).stdout.decode()
        effective='\n'.join(line for line in unit.splitlines() if not line.startswith('#')).strip()
        expected=(Path(__file__).parent.parent/'systemd'/'sawot-job@.service').read_text().strip()
        if effective!=expected: raise ValueError('Watchdog unit differs from reviewed definition')
        if require_proof:
            proof = Path('/var/lib/sawot-runner/verified.json')
            ps = proof.stat()
            if ps.st_uid != 0 or ps.st_mode & 0o022 or json.loads(proof.read_text()) != {'fingerprint':fingerprint(cfg,info)}:
                raise ValueError('Live isolation verification required')
        if Path('/proc/1/comm').read_text().strip() != 'systemd': raise ValueError('Independent watchdog unavailable')
        return {'ready':True,'runtime':'runsc','imageDigest':image,'inputPaths':'stable-v1'}
    except Exception:
        return {'ready':False,'runtime':'runsc','imageDigest':'','reason':'Runner requires verified gVisor, cgroup limits and watchdog'}

def atomic(path, value):
    temp=path.with_suffix('.tmp')
    with temp.open('w') as f:
        json.dump(value,f); f.flush(); os.fsync(f.fileno())
    temp.replace(path)

def write_manifest(path, items):
    atomic(path,items)
    os.chmod(path,0o444)

def stop(job_id):
    if not valid_id(job_id): raise ValueError('Invalid job')
    control(['/usr/bin/systemctl','stop',f'sawot-job@{job_id}.service'])

def release(job_id):
    stop(job_id)
    root=ROOT/job_id
    for name in ('work','inputs'):
        mount=root/name
        if mount.exists() and os.path.ismount(mount): control(['/usr/bin/umount',str(mount)])
    shutil.rmtree(root,ignore_errors=True)

def worker(job_id):
    if not valid_id(job_id): raise ValueError('Invalid job')
    root=ROOT/job_id
    request=json.loads((root/'request.json').read_text())
    # The systemd unit's RuntimeMaxSec covers staging and execution independently
    # of both the broker and this trusted worker.
    while not (root/'start').exists(): time.sleep(.05)
    result={'status':'unavailable','stdout':'','stderr':'Execution failed','exitCode':None,'durationMs':0,'truncated':False,'outputs':[]}
    try:
        result=execute(root,config()['image'])
    except Exception:
        pass
    atomic(root/'result.json',result)

def cleanup(job_id):
    if not valid_id(job_id): raise ValueError('Invalid job')
    # ExecStopPost runs even if the worker is killed. No guest controls this name.
    try: control(['/usr/bin/docker','rm','-f','sawot-'+job_id])
    except Exception: pass

def create_job(body):
    body=validate_request(body)
    if len(list(ROOT.iterdir()))>=limits.JOBS: raise ValueError('Runner busy')
    job_id=uuid.uuid4().hex; root=ROOT/job_id; root.mkdir(mode=0o700)
    try:
        atomic(root/'request.json',body); atomic(root/'created.json',time.time())
        control(['/usr/bin/systemctl','start',f'sawot-job@{job_id}.service'])
        for name,size in [('inputs',101),('work',128)]:
            dest=root/name; dest.mkdir()
            control(['/usr/bin/mount','-t','tmpfs','-o',f'size={size}m,nr_inodes=4096,nosuid,nodev,noexec','tmpfs',str(dest)])
        # Guest can traverse job mounts only; parent root is never mounted.
        os.chmod(root/'inputs',0o755); os.chmod(root/'work',0o755); os.chown(root/'work',65532,65532)
        for name in ('outputs','tmp','home','cache'):
            p=root/'work'/name; p.mkdir(); os.chown(p,65532,65532)
        (root/'inputs'/'code.py').write_text(body['code'])
        os.chmod(root/'inputs'/'code.py',0o444)
        for i,item in enumerate(body['inputs']):
            if 'id' in item: (root/'inputs'/item['id']).symlink_to(str(i))
        write_manifest(root/'inputs'/'manifest.json',[{'id':item.get('id',str(i)),'name':item['name'],'path':'/inputs/'+item.get('id',str(i))} for i,item in enumerate(body['inputs'])])
    except Exception:
        release(job_id); raise
    return job_id

class Handler(http.server.BaseHTTPRequestHandler):
    server_version='SAWOTRunner'
    def log_message(self,*args): pass
    def setup(self):
        super().setup(); self.connection.settimeout(5)
        # Absolute header/body deadline, including slow peers that never go idle.
        self.request_deadline=time.monotonic()+5
        def expire():
            try: self.connection.shutdown(socket.SHUT_RDWR)
            except OSError: pass
        self.deadline_timer=threading.Timer(5,expire);self.deadline_timer.daemon=True;self.deadline_timer.start()
    def finish(self):
        try: super().finish()
        finally: self.deadline_timer.cancel()
    def reply(self,status,value):
        data=json.dumps(value).encode()
        self.send_response(status); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)
    def body(self,max_size):
        if self.headers.get('Transfer-Encoding'): raise ValueError('Streaming framing not supported')
        raw=self.headers.get('Content-Length','')
        if not raw.isdigit() or int(raw)>max_size: raise ValueError('Body too large')
        chunks=[];remaining=int(raw)
        while remaining:
            if time.monotonic()>=self.request_deadline: raise ValueError('Request deadline exceeded')
            chunk=self.rfile.read1(min(65536,remaining))
            if not chunk: raise ValueError('Incomplete body')
            chunks.append(chunk);remaining-=len(chunk)
        data=b''.join(chunks)
        return data
    def do_GET(self): self.dispatch('GET')
    def do_POST(self): self.dispatch('POST')
    def do_PUT(self): self.dispatch('PUT')
    def do_DELETE(self): self.dispatch('DELETE')
    def dispatch(self,method):
        try:
            # Read bounded wire bytes before taking the shared job-state lock.
            # Upload liveness/size is rechecked under the lock before any write.
            self.wire_body=None
            if method=='POST' and self.path=='/v1/jobs': self.wire_body=self.body(128*1024)
            elif method=='PUT': self.wire_body=self.body(limits.INPUT_BYTES)
            with self.server.lock: self.handle_request(method)
        except (BrokenPipeError,ConnectionError): pass
        except Exception:
            self.reply(400,{'error':'Invalid or unavailable runner request'})
    def handle_request(self,method):
        parts=self.path.split('/')
        if method=='GET' and self.path=='/v1/ready': return self.reply(200,ready())
        if method=='POST' and self.path=='/v1/jobs':
            if not ready()['ready']: return self.reply(503,{'error':'Runner unavailable'})
            body=validate_request(json.loads(self.wire_body))
            if len(list(ROOT.iterdir()))>=limits.JOBS: return self.reply(429,{'error':'Runner busy'})
            job_id=create_job(body)
            return self.reply(201,{'id':job_id,'inputs':[str(i) for i in range(len(body['inputs']))]})
        if len(parts)<4 or parts[1:3]!=['v1','jobs'] or not valid_id(parts[3]): return self.reply(404,{'error':'Not found'})
        job_id=parts[3]; root=ROOT/job_id
        if not root.is_dir(): return self.reply(404,{'error':'Not found'})
        if method=='DELETE' and len(parts)==4:
            release(job_id); return self.reply(200,{'released':True})
        created=json.loads((root/'created.json').read_text())
        expired=time.time()-created>=limits.SECONDS
        request=json.loads((root/'request.json').read_text())
        if method=='PUT' and len(parts)==6 and parts[4]=='inputs':
            if expired or (root/'start').exists() or not parts[5].isdigit(): raise ValueError('Invalid input')
            index=int(parts[5]); size=request['inputs'][index]['size']; dest=root/'inputs'/str(index)
            data=self.wire_body
            if len(data)!=size: raise ValueError('Size mismatch')
            with dest.open('xb') as f: f.write(data)
            os.chmod(dest,0o444)
            return self.reply(200,{'stored':True})
        if method=='POST' and parts[4:]==['start']:
            if expired or (root/'start').exists(): raise ValueError('Job expired or started')
            for i,item in enumerate(request['inputs']):
                if (root/'inputs'/str(i)).stat().st_size!=item['size']: raise ValueError('Missing input')
            (root/'start').touch(exist_ok=False); return self.reply(202,{'started':True})
        if method=='GET' and len(parts)==4:
            if (root/'result.json').exists():
                result=json.loads((root/'result.json').read_text())
                result['outputs']=[{k:v for k,v in o.items() if not k.startswith('_')} for o in result['outputs']]
                return self.reply(200,{'state':'finished','result':result})
            if expired:
                stop(job_id)
                return self.reply(200,{'state':'finished','result':{'status':'timeout','stdout':'','stderr':'Execution deadline exceeded','exitCode':None,'durationMs':30000,'truncated':False,'outputs':[]}})
            return self.reply(200,{'state':'running'})
        if method=='GET' and len(parts)==6 and parts[4]=='outputs':
            result=json.loads((root/'result.json').read_text())
            output=next(o for o in result['outputs'] if o['id']==parts[5])
            # The worker has already stopped/removed the guest before publishing.
            directory=os.open(root/'work'/'outputs',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try: fd=os.open(output['_name'],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
            finally: os.close(directory)
            with os.fdopen(fd,'rb') as f:
                st=os.fstat(f.fileno())
                if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_size!=output['size']: raise ValueError('Invalid output')
                self.send_response(200); self.send_header('Content-Length',str(st.st_size)); self.end_headers()
                shutil.copyfileobj(f,self.wfile,length=65536)
            return
        self.reply(404,{'error':'Not found'})

class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True
    # Serialise filesystem state and bound live request threads at admission.
    def __init__(self,*args):
        self.lock=threading.RLock(); self.slots=threading.BoundedSemaphore(4)
        super().__init__(*args)
    def process_request(self,request,address):
        if not self.slots.acquire(blocking=False): request.close(); return
        try: super().process_request(request,address)
        except Exception: self.slots.release(); raise
    def process_request_thread(self,*args):
        try: super().process_request_thread(*args)
        finally: self.slots.release()

def serve():
    config(); ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
    for item in ROOT.iterdir():
        if valid_id(item.name): release(item.name)
    Path(SOCKET).parent.mkdir(parents=True,exist_ok=True)
    Path(SOCKET).unlink(missing_ok=True)
    with Server(SOCKET,Handler) as server:
        os.chmod(SOCKET,0o660)
        def reap():
            while True:
                time.sleep(1)
                with server.lock:
                    for root in ROOT.iterdir():
                        try:
                            if time.time()-json.loads((root/'created.json').read_text())>90: release(root.name)
                        except Exception: pass
        threading.Thread(target=reap,daemon=True).start()
        try: server.serve_forever()
        finally:
            for item in ROOT.iterdir():
                if valid_id(item.name): release(item.name)
