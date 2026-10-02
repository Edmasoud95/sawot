"""Collect stopped-guest output using descriptor-relative, no-follow reads."""
import hashlib
import os
import stat
from pathlib import Path
from . import limits


def collect_outputs(directory: Path) -> list[dict]:
    root = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    result = []
    total = 0
    try:
        names = sorted(os.listdir(root))
        if len(names) > limits.OUTPUT_COUNT:
            raise ValueError('Too many output files')
        for index, name in enumerate(names):
            info = os.stat(name, dir_fd=root, follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limits.OUTPUT_FILE:
                raise ValueError('Unsafe or oversized output file')
            total += info.st_size
            if total > limits.OUTPUT_BYTES:
                raise ValueError('Output quota exceeded')
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=root)
            with os.fdopen(fd, 'rb') as stream:
                current = os.fstat(stream.fileno())
                if (current.st_ino, current.st_dev) != (info.st_ino, info.st_dev):
                    raise ValueError('Output changed')
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            safe_name = ''.join(c for c in name if c.isprintable() and c not in '/\\')[:160] or 'output'
            result.append({'id': str(index), 'name': safe_name, 'size': info.st_size, 'sha256': digest, '_name': name})
        return result
    finally:
        os.close(root)
