import sys
from .server import serve, worker, cleanup
if len(sys.argv)==1:
    serve()
elif len(sys.argv)==3 and sys.argv[1] in ('worker','cleanup'):
    {'worker':worker,'cleanup':cleanup}[sys.argv[1]](sys.argv[2])
else:
    raise SystemExit('Invalid command')
