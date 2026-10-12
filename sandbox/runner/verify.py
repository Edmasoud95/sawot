"""Operator-only acceptance run. Receipt is tied to code, image, runtime and boot."""
import os
import argparse
import unittest
from pathlib import Path
from .server import atomic,config,fingerprint,ready,ROOT

RECEIPT = Path('/var/lib/sawot-runner/verified.json')

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--if-needed', action='store_true', help='Reuse valid verification for this boot and configuration')
    args = parser.parse_args(argv)
    if os.geteuid()!=0: raise SystemExit('Run on the prepared Linux runner host as root')
    if args.if_needed and ready()['ready']:
        print('Existing live isolation verification is valid')
        return
    receipt=RECEIPT
    receipt.unlink(missing_ok=True)
    if not ready(require_proof=False)['ready']: raise SystemExit('Missing verified runtime prerequisites; execution remains disabled')
    ROOT.mkdir(parents=True,exist_ok=True)
    if list(ROOT.iterdir()): raise SystemExit('Stop the broker and release outstanding jobs first')
    os.environ['SAWOT_SANDBOX_LIVE']='1'
    tests=unittest.defaultTestLoader.discover('sandbox/tests',pattern='test_live_*.py')
    result=unittest.TextTestRunner(verbosity=2).run(tests)
    if not result.wasSuccessful() or result.skipped or result.testsRun<15:
        raise SystemExit('Isolation checks did not pass; execution remains disabled')
    atomic(receipt,{'fingerprint':fingerprint(config())});os.chmod(receipt,0o600)
    print('Live isolation checks passed for this boot and configuration')
if __name__=='__main__':main()
