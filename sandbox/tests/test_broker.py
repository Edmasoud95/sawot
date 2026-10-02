import unittest
from sandbox.runner.server import valid_id, ready
class BrokerTests(unittest.TestCase):
    def test_ids_never_become_paths(self):
        for value in ('../etc', '', 'x'*32, 'a'*32+';id'):
            self.assertFalse(valid_id(value))
        self.assertTrue(valid_id('a'*32))
    def test_missing_config_fails_closed(self):
        self.assertFalse(ready({})['ready'])

    def test_guest_manifest_is_readable_under_restrictive_umask(self):
        import os,tempfile
        from pathlib import Path
        from sandbox.runner.server import write_manifest
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'manifest.json'
            previous=os.umask(0o007)
            try: write_manifest(p,[])
            finally: os.umask(previous)
            self.assertEqual(p.stat().st_mode & 0o777,0o444)
    def test_runtime_arguments_change_receipt_fingerprint(self):
        from sandbox.runner.server import fingerprint
        cfg={'image':'sha256:'+'a'*64,'runscSha256':'b'*64}
        self.assertNotEqual(fingerprint(cfg,{'ID':'daemon','Runtimes':{'runsc':{'path':'/runsc','runtimeArgs':[]}}}),fingerprint(cfg,{'ID':'daemon','Runtimes':{'runsc':{'path':'/runsc','runtimeArgs':['--network=host']}}}))
    def test_body_absolute_deadline(self):
        import io,time
        from sandbox.runner.server import Handler
        handler=object.__new__(Handler)
        handler.headers={'Content-Length':'1'};handler.rfile=io.BytesIO(b'x')
        handler.request_deadline=time.monotonic()-1
        with self.assertRaisesRegex(ValueError,'deadline'): handler.body(10)

    def test_stable_aliases_are_confined_to_input_directory(self):
        import tempfile,json
        from pathlib import Path
        from unittest.mock import patch
        from sandbox.runner import server
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            with patch.object(server,'ROOT',root),patch.object(server,'control'),patch.object(server.os,'chown'):
                job=server.create_job({'code':'print(1)','inputs':[{'id':'a'*32,'name':'data.csv','size':1}]})
            inputs=root/job/'inputs'
            self.assertEqual((inputs/('a'*32)).readlink(),Path('0'))
            (inputs/'0').write_text('x')
            self.assertEqual((inputs/('a'*32)).read_text(),'x')
            self.assertEqual(json.loads((inputs/'manifest.json').read_text())[0]['path'],'/inputs/'+'a'*32)
