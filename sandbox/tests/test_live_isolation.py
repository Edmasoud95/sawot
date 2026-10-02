"""Runs only via a prepared Linux host. Never execute fixture code with host Python."""
import json
import os
import time
import unittest
from pathlib import Path
from sandbox.runner.server import ROOT, ready, create_job, release, stop
from sandbox.runner.runtime import control

@unittest.skipUnless(os.getenv('SAWOT_SANDBOX_LIVE')=='1', 'real gVisor host required')
class LiveIsolationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.geteuid()!=0: raise RuntimeError('Live verifier needs the trusted host operator')
        if not ready(require_proof=False)['ready']: raise RuntimeError('gVisor/cgroups/systemd prerequisites unavailable')
        ROOT.mkdir(parents=True,exist_ok=True)
        if list(ROOT.iterdir()): raise RuntimeError('Stop the broker and clear its jobs before verification')
    def run_guest(self,code,inputs=(),file_ids=()):
        job=create_job({'code':code,'inputs':[{'name':name,'size':len(data),**({'id':file_ids[i]} if file_ids else {})} for i,(name,data) in enumerate(inputs)]})
        root=ROOT/job
        try:
            for i,(_,data) in enumerate(inputs):
                (root/'inputs'/str(i)).write_bytes(data);os.chmod(root/'inputs'/str(i),0o444)
            (root/'start').touch()
            deadline=time.monotonic()+36
            while time.monotonic()<deadline:
                if (root/'result.json').exists(): return json.loads((root/'result.json').read_text())
                time.sleep(.1)
            # An expired unit must already have killed the container independently.
            state=control(['/usr/bin/systemctl','show',f'sawot-job@{job}.service','--property=ActiveState','--value']).stdout.strip()
            self.assertIn(state,(b'failed',b'inactive'))
            containers=control(['/usr/bin/docker','ps','-aq','--filter','name=^/sawot-'+job+'$']).stdout.strip()
            self.assertEqual(containers,b'')
            return {'status':'timeout','stdout':'','outputs':[]}
        finally: release(job)
    def test_csv_and_fresh_interpreter(self):
        result=self.run_guest("""import pandas as pd
import json
assert json.load(open('/inputs/manifest.json'))[0]['path']=='/inputs/0'
x=pd.read_csv('/inputs/0')
print(x['value'].sum())
x.to_csv('/outputs/result.csv',index=False)
""", [('sales.csv',b'value\n2\n3\n')])
        self.assertEqual(result['status'],'success');self.assertEqual(result['stdout'].strip(),'5');self.assertEqual(len(result['outputs']),1)
        fresh=self.run_guest("print('x' in globals())")
        self.assertEqual(fresh['stdout'].strip(),'False')
    def test_stable_paths_survive_reordered_selection(self):
        first,second='a'*32,'b'*32
        for inputs,ids in [([('first.csv',b'first'),('second.csv',b'second')],[first,second]),([('second.csv',b'second'),('first.csv',b'first')],[second,first])]:
            result=self.run_guest("""import json
from pathlib import Path
manifest=json.load(open('/inputs/manifest.json'))
for item in manifest: assert item['path']=='/inputs/'+item['id']
assert Path('/inputs/"""+first+"""').read_text()=='first'
assert Path('/inputs/"""+second+"""').read_text()=='second'
assert not Path('/inputs/"""+'c'*32+"""').exists()
try:
 Path('/inputs/"""+first+"""').write_text('changed')
 raise AssertionError('input writable')
except OSError: pass
print('stable and readonly')
""",inputs,ids)
            self.assertEqual(result['status'],'success',result)
            self.assertEqual(result['stdout'].strip(),'stable and readonly')
    def test_input_read_only_and_no_host_files(self):
        canary=Path('/var/lib/sawot-runner/host-canary');canary.write_text('synthetic-host-secret')
        try:
            result=self.run_guest("""from pathlib import Path
for p in ['/var/lib/sawot-runner/host-canary','/var/run/docker.sock','/etc/sawot-runner.json']:
 assert not Path(p).exists(),p
try:
 Path('/inputs/0').write_text('changed')
 raise AssertionError('input writable')
except OSError: pass
print('isolated')
""", [('input.txt',b'original')])
            self.assertEqual(result['status'],'success');self.assertEqual(canary.read_text(),'synthetic-host-secret')
        finally: canary.unlink(missing_ok=True)
    def test_network_and_dns_denied(self):
        result=self.run_guest("""import socket
for host,port in [('1.1.1.1',443),('169.254.169.254',80),('192.168.1.1',80),('127.0.0.1',8765)]:
 try:
  s=socket.create_connection((host,port),timeout=.3);s.close()
  raise AssertionError('network accessible')
 except OSError: pass
try:
 socket.getaddrinfo('example.org',443)
 raise AssertionError('DNS accessible')
except OSError: pass
print('offline')
""")
        self.assertEqual(result['status'],'success');self.assertEqual(result['stdout'].strip(),'offline')
    def test_symlink_cannot_export(self):
        result=self.run_guest("import os\nos.symlink('/etc/passwd','/outputs/link')")
        self.assertNotEqual(result['status'],'success');self.assertEqual(result['outputs'],[])
    def test_logs_are_bounded(self):
        result=self.run_guest("print('x'*1000000)")
        self.assertEqual(result['status'],'success');self.assertTrue(result['truncated']);self.assertLessEqual(len(result['stdout'].encode()),65536)
    def test_disk_limit(self):
        result=self.run_guest("""import os
try:
 with open('/work/full','wb') as f:
  for _ in range(200): f.write(b'x'*1048576)
 raise AssertionError('disk unbounded')
except OSError: print('bounded')
""")
        self.assertEqual(result['status'],'success');self.assertEqual(result['stdout'].strip(),'bounded')
    def test_memory_limit(self):
        result=self.run_guest("x=[]\nwhile True: x.append(bytearray(10*1024*1024))")
        self.assertIn(result['status'],('resource_limit','python_error'))
    def test_process_limit(self):
        result=self.run_guest("""import os,time,resource
assert resource.getrlimit(resource.RLIMIT_NPROC)==(64,64)
children=[]
try:
 for _ in range(80):
  pid=os.fork()
  if pid==0:
   time.sleep(20);os._exit(0)
  children.append(pid)
 raise AssertionError('process limit not enforced')
except OSError:
 assert len(children)<=63, len(children)
 print('bounded',flush=True)
finally:
 for pid in children:
  os.kill(pid,9);os.waitpid(pid,0)
""")
        self.assertEqual(result['status'],'success',result);self.assertEqual(result['stdout'].strip(),'bounded')
    def test_independent_deadline(self):
        # No broker process is running: only the systemd worker can end this job.
        result=self.run_guest('while True: pass')
        self.assertEqual(result['status'],'timeout')
    def test_spreadsheets_pdf_and_malformed_documents(self):
        result=self.run_guest("""from openpyxl import Workbook,load_workbook
from pypdf import PdfWriter,PdfReader
w=Workbook();w.active.append(['value']);w.active.append([5]);w.save('/work/test.xlsx')
assert load_workbook('/work/test.xlsx').active['A2'].value==5
p=PdfWriter();p.add_blank_page(width=100,height=100);p.write('/work/test.pdf')
assert len(PdfReader('/work/test.pdf').pages)==1
from io import BytesIO
try: PdfReader(BytesIO(b'broken'))
except Exception: print('parsed')
""")
        self.assertEqual(result['status'],'success');self.assertEqual(result['stdout'].strip(),'parsed')
    def test_effective_cpu_memory_swap_and_mount_controls(self):
        job=create_job({'code':'import time\ntime.sleep(20)','inputs':[]});root=ROOT/job
        try:
            (root/'start').touch();info=None
            for _ in range(50):
                try:
                    candidate=json.loads(control(['/usr/bin/docker','inspect','sawot-'+job]).stdout)[0]
                    if candidate['State']['Running']: info=candidate;break
                except Exception: pass
                time.sleep(.1)
            self.assertIsNotNone(info)
            host=info['HostConfig']
            self.assertEqual(host['Runtime'],'runsc');self.assertEqual(host['NetworkMode'],'none')
            self.assertEqual(host['Memory'],512*1024*1024);self.assertEqual(host['MemorySwap'],host['Memory']);self.assertEqual(host['NanoCpus'],1000000000)
            self.assertEqual(host['PidsLimit'],256)
            self.assertTrue(host['ReadonlyRootfs']);self.assertEqual(info['Config']['User'],'65532:65532')
            self.assertEqual({m['Destination'] for m in info['Mounts']},{'/inputs','/work','/tmp'})
            pid=info['State']['Pid'];membership=Path(f'/proc/{pid}/cgroup').read_text()
            relative=next(line.split('::',1)[1] for line in membership.splitlines() if line.startswith('0::'))
            group=Path('/sys/fs/cgroup')/relative.lstrip('/')
            self.assertEqual((group/'memory.max').read_text().strip(),str(512*1024*1024))
            self.assertEqual((group/'memory.swap.max').read_text().strip(),'0')
            self.assertEqual((group/'pids.max').read_text().strip(),'256')
            quota,period=(group/'cpu.max').read_text().split();self.assertNotEqual(quota,'max');self.assertLessEqual(int(quota),int(period))
        finally: release(job)
    def test_cross_job_files_are_not_shared(self):
        victim=create_job({'code':'print(1)','inputs':[{'name':'secret.txt','size':6}]})
        try:
            (ROOT/victim/'inputs'/'0').write_bytes(b'canary')
            result=self.run_guest("from pathlib import Path\nassert not Path('/inputs/0').exists()\nassert not Path('/var/lib/sawot-runner/jobs/"+victim+"/inputs/0').exists()\nprint('separate')")
            self.assertEqual(result['status'],'success');self.assertEqual(result['stdout'].strip(),'separate')
        finally: release(victim)
    def test_children_cannot_survive_parent_exit(self):
        job=create_job({'code':"import os,time\npid=os.fork()\nif pid==0:\n time.sleep(2)\n open('/work/late','w').write('alive')\nelse: print('parent done',flush=True)",'inputs':[]})
        root=ROOT/job
        try:
            (root/'start').touch()
            for _ in range(100):
                if (root/'result.json').exists():break
                time.sleep(.1)
            self.assertTrue((root/'result.json').exists())
            time.sleep(2.5)
            self.assertFalse((root/'work'/'late').exists())
            self.assertEqual(control(['/usr/bin/docker','ps','-aq','--filter','name=^/sawot-'+job+'$']).stdout.strip(),b'')
        finally: release(job)
    def test_worker_crash_triggers_external_cleanup(self):
        job=create_job({'code':'while True: pass','inputs':[]});root=ROOT/job
        try:
            (root/'start').touch()
            for _ in range(50):
                running=control(['/usr/bin/docker','ps','-q','--filter','name=^/sawot-'+job+'$']).stdout.strip()
                if running:break
                time.sleep(.1)
            self.assertTrue(running)
            control(['/usr/bin/systemctl','kill','--signal=KILL','--kill-whom=main',f'sawot-job@{job}.service'])
            for _ in range(100):
                left=control(['/usr/bin/docker','ps','-aq','--filter','name=^/sawot-'+job+'$']).stdout.strip()
                if not left:break
                time.sleep(.1)
            self.assertEqual(left,b'')
        finally: release(job)
