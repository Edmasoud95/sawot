import os
import tempfile
import unittest
from pathlib import Path
from sandbox.runner.runtime import command, validate_request
from sandbox.runner.storage import collect_outputs

class RuntimeTests(unittest.TestCase):
    def test_fixed_command(self):
        args = command('sha256:' + 'a' * 64, 'sawot-' + 'a'*32, Path('/tmp/job'))
        for flag in ('--runtime=runsc', '--network=none', '--read-only', '--cap-drop=ALL', '--memory=512m', '--memory-swap=512m', '--cpus=1', '--user=65532:65532', '--log-driver=none', '--pids-limit=256', '--ulimit=nproc=64:64'):
            self.assertIn(flag, args)
        self.assertNotIn('/var/run/docker.sock', ' '.join(args))
        self.assertNotIn('--privileged', args)
        self.assertIn('type=bind,src=/tmp/job/work/tmp,dst=/tmp', args)
    def test_request_rejects_options_and_large_source(self):
        for body in ({'code':'print(1)', 'inputs':[], 'image':'evil'}, {'code':'x'*65537,'inputs':[]}, {'code':'x','inputs':[{'name':'../x','size':-1}]}):
            with self.assertRaises(ValueError): validate_request(body)
        self.assertEqual(validate_request({'code':'print(1)', 'inputs':[]})['code'], 'print(1)')
    def test_outputs_are_regular_bounded_files(self):
        with tempfile.TemporaryDirectory() as root:
            out=Path(root)
            (out/'good.csv').write_text('x\n5\n')
            self.assertEqual(collect_outputs(out)[0]['size'], 4)
            (out/'link').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError): collect_outputs(out)
    def test_fifo_and_hardlinks_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            out=Path(root); os.mkfifo(out/'fifo')
            with self.assertRaises(ValueError): collect_outputs(out)
            (out/'fifo').unlink(); (out/'a').write_text('x'); os.link(out/'a', out/'b')
            with self.assertRaises(ValueError): collect_outputs(out)

    def test_stable_input_ids_are_validated_and_unique(self):
        good={'id':'a'*32,'name':'data.csv','size':2}
        self.assertEqual(validate_request({'code':'print(1)','inputs':[good]})['inputs'][0]['id'],'a'*32)
        for items in ([{**good,'id':'../etc/passwd'}],[good,good]):
            with self.assertRaises(ValueError):validate_request({'code':'print(1)','inputs':items})
