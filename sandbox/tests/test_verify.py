import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from sandbox.runner import verify


class VerificationStartupTests(unittest.TestCase):
    def test_valid_receipt_skips_live_jobs(self):
        with patch.object(verify.os, 'geteuid', return_value=0), \
             patch.object(verify, 'ready', return_value={'ready': True}) as ready, \
             patch.object(verify.unittest.defaultTestLoader, 'discover') as discover:
            verify.main(['--if-needed'])
        ready.assert_called_once_with()
        discover.assert_not_called()

    def test_stale_receipt_runs_all_checks_before_replacing_proof(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = root / 'verified.json'
            receipt.write_text('stale')
            result = unittest.TestResult()
            result.testsRun = 15
            with patch.object(verify.os, 'geteuid', return_value=0), \
                 patch.dict(verify.os.environ), \
                 patch.object(verify, 'RECEIPT', receipt, create=True), \
                 patch.object(verify, 'ROOT', root / 'jobs'), \
                 patch.object(verify, 'ready', side_effect=[{'ready': False}, {'ready': True}]), \
                 patch.object(verify, 'config', return_value={}), \
                 patch.object(verify, 'fingerprint', return_value='new'), \
                 patch.object(verify.unittest.defaultTestLoader, 'discover'), \
                 patch.object(verify.unittest.TextTestRunner, 'run', return_value=result):
                verify.main(['--if-needed'])
            self.assertEqual(receipt.read_text(), '{"fingerprint": "new"}')
            self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)

    def test_failed_checks_leave_no_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = root / 'verified.json'
            receipt.write_text('stale')
            result = unittest.TestResult()
            result.testsRun = 14
            with patch.object(verify.os, 'geteuid', return_value=0), \
                 patch.dict(verify.os.environ), \
                 patch.object(verify, 'RECEIPT', receipt, create=True), \
                 patch.object(verify, 'ROOT', root / 'jobs'), \
                 patch.object(verify, 'ready', side_effect=[{'ready': False}, {'ready': True}]), \
                 patch.object(verify.unittest.defaultTestLoader, 'discover'), \
                 patch.object(verify.unittest.TextTestRunner, 'run', return_value=result):
                with self.assertRaisesRegex(SystemExit, 'Isolation checks did not pass'):
                    verify.main(['--if-needed'])
            self.assertFalse(receipt.exists())

    def test_non_root_cannot_reuse_receipt(self):
        with patch.object(verify.os, 'geteuid', return_value=1000):
            with self.assertRaisesRegex(SystemExit, 'as root'):
                verify.main(['--if-needed'])
