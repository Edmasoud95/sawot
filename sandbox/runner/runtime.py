import json
import os
import re
import selectors
import subprocess
import time
from pathlib import Path
from . import limits
from .storage import collect_outputs

ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8'}

def control(args, timeout=10):
    return subprocess.run(args, shell=False, env=ENV, check=True, capture_output=True, timeout=timeout)


def validate_request(body):
    if not isinstance(body, dict) or set(body) != {'code', 'inputs'}:
        raise ValueError('Expected code and inputs only')
    if not isinstance(body['code'], str) or not 0 < len(body['code'].encode()) <= limits.CODE:
        raise ValueError('Invalid code size')
    items = body['inputs']
    if not isinstance(items, list) or len(items) > limits.INPUT_COUNT:
        raise ValueError('Invalid inputs')
    total = 0
    ids = set()
    for item in items:
        if not isinstance(item, dict) or set(item) not in ({'name', 'size'}, {'id', 'name', 'size'}):
            raise ValueError('Invalid input metadata')
        if 'id' in item:
            if not isinstance(item['id'],str) or not re.fullmatch('[0-9a-f]{32}',item['id']) or item['id'] in ids: raise ValueError('Invalid input id')
            ids.add(item['id'])
        if not isinstance(item['name'], str) or len(item['name']) > 160 or not item['name'].isprintable():
            raise ValueError('Invalid display name')
        if type(item['size']) is not int or not 0 <= item['size'] <= limits.INPUT_BYTES:
            raise ValueError('Invalid input size')
        total += item['size']
    if total > limits.INPUT_BYTES:
        raise ValueError('Input quota exceeded')
    return body


def command(image: str, name: str, root: Path):
    if not re.fullmatch(r'sha256:[0-9a-f]{64}', image) or not re.fullmatch(r'sawot-[0-9a-f]{32}', name):
        raise ValueError('Invalid trusted runtime configuration')
    # gVisor needs host threads in addition to the 64 guest processes.
    # A 128-task host cap terminated the runtime before guest fork returned EAGAIN.
    return ['/usr/bin/docker', 'run', '--pull=never', '--name', name, '--label=sawot.sandbox=1',
        '--runtime=runsc', '--network=none', '--read-only', '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true', '--user=65532:65532', '--cpus=1',
        '--memory=512m', '--memory-swap=512m', '--pids-limit=256', '--ulimit=nproc=64:64',
        '--ulimit=nofile=256:256', '--ipc=none', '--log-driver=none',
        '--mount', f'type=bind,src={root}/inputs,dst=/inputs,readonly',
        '--mount', f'type=bind,src={root}/work,dst=/work',
        '--mount', f'type=bind,src={root}/work/tmp,dst=/tmp',
        '--env=HOME=/work/home', '--env=TMPDIR=/work/tmp', '--env=MPLCONFIGDIR=/work/cache',
        '--env=OPENBLAS_NUM_THREADS=1', '--env=OMP_NUM_THREADS=1', '--env=MKL_NUM_THREADS=1',
        '--workdir=/work', '--entrypoint=/usr/local/bin/python3', image, '-I', '-B', '/inputs/code.py']


def execute(root: Path, image: str):
    name = 'sawot-' + root.name
    start = time.monotonic()
    status, exit_code = 'unavailable', None
    logs = [bytearray(), bytearray()]
    captured = 0
    truncated = False
    proc = None
    try:
        proc = subprocess.Popen(command(image, name, root), shell=False, env=ENV,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ, 0)
            selector.register(proc.stderr, selectors.EVENT_READ, 1)
            while selector.get_map():
                if time.monotonic() - start >= limits.SECONDS:
                    status = 'timeout'
                    break
                for key, _ in selector.select(0.2):
                    chunk = os.read(key.fileobj.fileno(), 8192)
                    if not chunk:
                        selector.unregister(key.fileobj)
                        continue
                    keep = min(len(chunk), limits.LOG_BYTES - captured)
                    logs[key.data].extend(chunk[:keep]); captured += keep
                    truncated |= keep != len(chunk)
        if status != 'timeout':
            exit_code = proc.wait(timeout=1)
            info = json.loads(control(['/usr/bin/docker', 'inspect', name]).stdout)[0]
            status = 'resource_limit' if info['State']['OOMKilled'] else ('success' if exit_code == 0 else 'python_error')
            if info['State']['Running'] or info['HostConfig']['Runtime'] != 'runsc':
                raise ValueError('Invalid runtime state')
    finally:
        # No output may be opened until all guest processes are gone.
        try:
            control(['/usr/bin/docker', 'rm', '-f', name])
        finally:
            if proc:
                if proc.poll() is None: proc.kill()
                proc.wait()
                proc.stdout.close(); proc.stderr.close()
    outputs = collect_outputs(root / 'work' / 'outputs') if status == 'success' else []
    return {'status': status, 'stdout': logs[0].decode('utf-8', 'replace'),
            'stderr': logs[1].decode('utf-8', 'replace'), 'exitCode': exit_code,
            'durationMs': int((time.monotonic()-start)*1000), 'truncated': truncated, 'outputs': outputs}
