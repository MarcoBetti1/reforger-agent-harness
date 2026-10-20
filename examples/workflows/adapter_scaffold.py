"""Inert addon adapter starting point. Emits NOT_TESTED and starts no renderer.

Copy into the addon QA folder, then implement docs/workflow-adapters.md using
its qualified native fixture/lifecycle. Do not change the statuses to PASS
without corresponding native measurements and normal owned closure evidence.
"""
import json
from pathlib import Path
import sys

request_file, result_file, cancel_file = map(Path, sys.argv[1:])
request = json.loads(request_file.read_text(encoding='utf-8-sig'))
evidence = Path(request['attemptDir']) / 'adapter-not-configured.json'
evidence.write_text(json.dumps({'nativeStarted': False, 'cancelRequested': cancel_file.exists(),
                               'reason': 'Implement the addon-owned native adapter before testing.'}, indent=2) + '\n')
out = {'schema': 1, 'runId': request['runId'], 'caseId': request['caseId'],
       'infrastructure': {'status': 'NOT_TESTED', 'reason': 'Inert scaffold: native adapter not implemented'},
       'assertions': {name: {'status': 'NOT_TESTED', 'reason': 'No native measurement'} for name in request['assertions']},
       'lifecycle': {'status': 'PASS', 'reason': 'Scaffold started no renderer and claimed no lease',
                     'verifiedExited': True, 'leaseReleased': True}, 'evidence': [str(evidence)]}
with result_file.open('x', encoding='utf-8') as stream:
    json.dump(out, stream, indent=2)
    stream.write('\n')
sys.exit(2)
