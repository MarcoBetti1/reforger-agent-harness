"""Small, addon-independent batch coordinator. Never controls a game process.

Adapters own native admission, reset, identity, close and lease release. A case
cannot pass from exit code or a marker alone. See docs/workflows.md.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import sys
import time
import uuid

TEMPLATES = Path(__file__).resolve().parents[1] / 'examples/workflows/templates.json'
REGISTRY = Path(__file__).resolve().parents[1] / 'reforger-workflows.local.json'
STATUSES = {'PASS', 'FAIL', 'NOT_TESTED'}
LABEL = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')
MAX_ADAPTER_LOG_BYTES = 64 * 1024**2


class WorkflowError(ValueError):
    pass


def require(condition, reason):
    if not condition:
        raise WorkflowError(reason)


def read_json(file):
    def unique(pairs):
        out = {}
        for key, value in pairs:
            require(key not in out, 'Duplicate JSON key: ' + key)
            out[key] = value
        return out
    def reject(value):
        raise WorkflowError('Nonfinite JSON value: ' + value)
    def finite_float(value):
        parsed = float(value)
        require(math.isfinite(parsed), 'Nonfinite JSON number: ' + value)
        return parsed
    data = Path(file).read_bytes()
    require(len(data) <= 4 * 1024**2, 'JSON exceeds 4 MiB: ' + str(file))
    return json.loads(data.decode('utf-8-sig'), object_pairs_hook=unique, parse_constant=reject, parse_float=finite_float)


def sha(file):
    digest = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def save(file, value):
    # Exclusive creation: failed/partial writes stay visible, never overwrite a run.
    with Path(file).open('x', encoding='utf-8') as stream:
        json.dump(value, stream, indent=2, allow_nan=False)
        stream.write('\n')


def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def exact_keys(value, allowed, required):
    require(isinstance(value, dict), 'Expected JSON object')
    require(not (set(value) - set(allowed)), 'Unknown fields: ' + ', '.join(sorted(set(value) - set(allowed))))
    require(set(required) <= set(value), 'Missing fields: ' + ', '.join(sorted(set(required) - set(value))))


def strings(value, name, minimum=0):
    require(isinstance(value, list) and minimum <= len(value) <= 256, name + ': expected bounded array')
    require(all(isinstance(v, str) and v and '\0' not in v for v in value), name + ': expected nonempty strings')
    require(len(value) == len(set(value)), name + ': duplicate values')
    return value


def file_identity(file):
    p = Path(file).resolve(strict=True)
    require(p.is_file(), 'Expected file: ' + str(p))
    return {'path': str(p), 'bytes': p.stat().st_size, 'sha256': sha(p)}


def resolve(base, value):
    require(isinstance(value, str) and value, 'Expected path string')
    return (base / value).resolve()


def bindings(registry):
    registry = Path(registry).resolve()
    require(registry.is_file(), 'Local workflow registry absent; copy examples/workflows/bindings.example.json to ' + str(registry))
    data = read_json(registry)
    exact_keys(data, ['schema', 'bindings'], ['schema', 'bindings'])
    require(type(data['schema']) is int and data['schema'] == 1, 'Unsupported binding registry schema')
    require(isinstance(data['bindings'], dict) and 1 <= len(data['bindings']) <= 32, 'Registry needs 1..32 named bindings')
    rows = {}
    for name, row in data['bindings'].items():
        require(LABEL.fullmatch(name), 'Safe binding name required')
        exact_keys(row, ['job', 'description', 'outputRoot'], ['job', 'description', 'outputRoot'])
        require(isinstance(row['description'], str) and 1 <= len(row['description']) <= 2048, 'Binding description required')
        rows[name] = {'job': str(resolve(registry.parent, row['job'])), 'description': row['description'],
                      'outputRoot': str(resolve(registry.parent, row['outputRoot']))}
    return {'schema': 1, 'status': 'NOT_TESTED', 'reason': 'Local aliases only; plan and qualify the addon-owned adapter before execution',
            'registry': str(registry), 'bindings': rows}


def selected_job(args):
    if args.job:
        return args.job, None
    rows = bindings(args.registry)['bindings']
    require(args.binding in rows, 'Unknown local binding; use workflow.py bindings')
    return rows[args.binding]['job'], rows[args.binding]['outputRoot']


def dependency_preflight(project, roots):
    """Bounded project discovery; no guessed fallback and no native load claim."""
    candidates = {Path(project).resolve()}
    for root in roots:
        require(root.is_dir(), 'Addon root absent: ' + str(root))
        candidates.update(p.resolve() for p in root.glob('*.gproj') if p.is_file())
        candidates.update(p.resolve() for p in root.glob('*/*.gproj') if p.is_file())
    require(len(candidates) <= 512, 'Too many projects; narrow addon roots')
    by_id = {}
    for p in sorted(candidates):
        require(p.stat().st_size <= 4 * 1024**2, 'Project exceeds size cap')
        text = p.read_text(encoding='utf-8-sig')
        ids = re.findall(r'\bGUID\s+"([0-9a-fA-F]{16})"', text)
        require(len(ids) == 1, 'Project GUID absent/ambiguous: ' + str(p))
        guid = ids[0].upper()
        require(guid not in by_id, 'Duplicate mounted project GUID ' + guid + ': ' + str(p))
        dependencies = re.search(r'\bDependencies\s*\{([^}]*)\}', text, re.S)
        by_id[guid] = {'path': str(p), 'dependencies': re.findall(r'"([0-9a-fA-F]{16})"', dependencies[1]) if dependencies else []}
    needed = []
    def visit(guid):
        guid = guid.upper()
        if guid in needed:
            return
        require(guid in by_id, 'Missing mounted dependency GUID ' + guid + '; include installed base-game/addon roots explicitly')
        needed.append(guid)
        p = Path(by_id[guid]['path'])
        if (p.parent / 'data.pak').exists():
            for name in ('data.pak', 'resourceDatabase.rdb'):
                f = p.parent / name
                require(f.is_file() and f.stat().st_size > 0, 'Packed dependency missing/empty: ' + str(f))
        for dep in by_id[guid]['dependencies']:
            visit(dep)
    selected = next(guid for guid, row in by_id.items() if row['path'] == str(project))
    visit(selected)
    return {guid: by_id[guid] for guid in needed}


def plan(job_path):
    job_path = Path(job_path).resolve(strict=True)
    job = read_json(job_path)
    exact_keys(job, ['schema', 'template', 'project', 'world', 'sourceRoots', 'addonRoots', 'requiredFiles', 'requiredClasses',
                     'capabilities', 'adapter', 'cases', 'timeoutSeconds', 'closeGraceSeconds', 'notes'],
                    ['schema', 'template', 'project', 'world', 'sourceRoots', 'addonRoots', 'requiredFiles', 'requiredClasses',
                     'capabilities', 'adapter', 'cases', 'timeoutSeconds', 'closeGraceSeconds'])
    require(job['schema'] == 1, 'Unsupported job schema')
    templates = read_json(TEMPLATES)
    require(isinstance(job['template'], str) and job['template'] in templates, 'Unknown template; use workflow.py templates')
    template = templates[job['template']]
    strings(job['capabilities'], 'capabilities')
    require(set(template['capabilities']) <= set(job['capabilities']), 'Adapter lacks template capabilities: ' + ', '.join(sorted(set(template['capabilities']) - set(job['capabilities']))))
    require(type(job['timeoutSeconds']) is int and 1 <= job['timeoutSeconds'] <= 7200, 'timeoutSeconds must be 1..7200')
    require(type(job['closeGraceSeconds']) is int and 1 <= job['closeGraceSeconds'] <= 120, 'closeGraceSeconds must be 1..120')
    project = resolve(job_path.parent, job['project'])
    require(project.suffix.lower() == '.gproj', 'Explicit .gproj required')
    project_pin = file_identity(project)
    project_text = project.read_text(encoding='utf-8-sig')
    ids = re.findall(r'\bGUID\s+"([0-9a-fA-F]{16})"', project_text)
    require(len(ids) == 1, 'Project must declare exactly one GUID')
    addon_roots = [resolve(job_path.parent, v) for v in strings(job['addonRoots'], 'addonRoots', 1)]
    dependencies = dependency_preflight(project, addon_roots)
    require(isinstance(job['world'], str) and job['world'].lower().endswith('.ent') and '..' not in Path(job['world']).parts, 'Explicit world resource .ent required')
    roots = [resolve(job_path.parent, v) for v in strings(job['sourceRoots'], 'sourceRoots', 1)]
    require(all(p.is_dir() for p in roots), 'Source root absent')
    require(len(set(roots)) == len(roots), 'Duplicate source root')
    # Check text resources with an exact local path. GUID resolution and binary
    # dependencies still require native compile/load evidence from the adapter.
    world_path = re.sub(r'^\{[0-9a-fA-F]{16}\}', '', job['world'])
    require(re.fullmatch(r'[A-Za-z0-9_./-]+\.ent', world_path) and not world_path.startswith('/')
            and '..' not in Path(world_path).parts, 'World must be a relative resource inside source roots')
    worlds = {(p / world_path).resolve() for p in roots if (p / world_path).is_file()}
    require(all(any(world.is_relative_to(root) for root in roots) for world in worlds), 'World resolves outside source roots')
    require(worlds, 'World not found in supplied source roots: ' + world_path)
    require(len(worlds) == 1, 'Ambiguous world in supplied source roots: ' + world_path)
    world_pin = file_identity(next(iter(worlds)))
    pins = {project_pin['path']: project_pin, world_pin['path']: world_pin}
    for row in dependencies.values():
        pins[row['path']] = file_identity(row['path'])
    require(isinstance(job['requiredFiles'], list) and len(job['requiredFiles']) <= 256, 'requiredFiles must be bounded array')
    for row in job['requiredFiles']:
        exact_keys(row, ['path', 'sha256'], ['path'])
        pin = file_identity(resolve(job_path.parent, row['path']))
        if 'sha256' in row:
            require(pin['sha256'] == row['sha256'], 'Pinned file differs: ' + pin['path'])
        pins[pin['path']] = pin
    classes = strings(job['requiredClasses'], 'requiredClasses')
    require(all(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', v) for v in classes), 'Invalid class identifier')
    definitions = {v: [] for v in classes}
    scanned = 0
    for root in roots:
        scripts = root / 'scripts'
        if not scripts.exists():
            scripts = root / 'Scripts'
        for base, dirs, files in os.walk(scripts):
            dirs[:] = [d for d in dirs if not Path(base, d).is_symlink()]
            for name in files:
                if not name.lower().endswith('.c'):
                    continue
                scanned += 1
                require(scanned <= 10000, 'Source scan exceeds 10,000 files; narrow roots')
                p = Path(base, name)
                require(p.stat().st_size <= 4 * 1024**2, 'Source file exceeds 4 MiB')
                text = p.read_text(encoding='utf-8-sig')
                text = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
                for cls in classes:
                    if re.search(r'\bclass\s+' + re.escape(cls) + r'\b', text):
                        definitions[cls].append(str(p.resolve()))
                        pins[str(p.resolve())] = file_identity(p)
    for cls, files in definitions.items():
        require(files, 'Required fixture class missing: ' + cls)
    adapter = job['adapter']
    exact_keys(adapter, ['executable', 'script', 'args'], ['executable', 'script', 'args'])
    executable = resolve(job_path.parent, adapter['executable'])
    script = resolve(job_path.parent, adapter['script'])
    # No shells/command strings. .ps1 uses PowerShell's -File; .py uses Python.
    executable_pin = file_identity(executable)
    script_pin = file_identity(script)
    pins[script_pin['path']] = script_pin
    args = strings(adapter['args'], 'adapter.args')
    allowed_tokens = {'{script}', '{request}', '{result}', '{cancel}'}
    require('{script}' in args and '{request}' in args and '{result}' in args and '{cancel}' in args, 'Adapter args must contain exact script/request/result/cancel tokens')
    require(all(not ('{' in a or '}' in a) or a in allowed_tokens for a in args), 'Only exact adapter tokens supported')
    require(isinstance(job['cases'], list) and 1 <= len(job['cases']) <= 256, 'cases must contain 1..256 rows')
    names = set()
    cases = []
    for case in job['cases']:
        exact_keys(case, ['id', 'parameters', 'assertions'], ['id', 'parameters', 'assertions'])
        require(isinstance(case['id'], str) and LABEL.fullmatch(case['id']) and case['id'] not in names, 'Unique safe case ID required')
        names.add(case['id'])
        strings(case['assertions'], 'case.assertions', 1)
        require(set(template['requiredAssertions']) <= set(case['assertions']), 'Case missing mandatory template assertions')
        require(isinstance(case['parameters'], dict), 'Case parameters must be object')
        cases.append(case)
    return {'schema': 1, 'status': 'NOT_TESTED', 'reason': 'Plan only; capabilities are declarations, native compile/load and behavior remain untested',
            'job': str(job_path), 'jobSha256': sha(job_path), 'template': job['template'], 'templateSha256': sha(TEMPLATES),
            'project': str(project), 'projectGuid': ids[0].upper(), 'world': job['world'], 'dependencies': dependencies, 'classDefinitions': definitions,
            'pins': list(pins.values()), 'executable': executable_pin, 'script': str(script), 'args': args,
            'coordinator': file_identity(Path(__file__)),
            'capabilities': job['capabilities'], 'cases': cases, 'timeoutSeconds': job['timeoutSeconds'],
            'closeGraceSeconds': job['closeGraceSeconds'], 'limits': template['limits']}


def not_tested(reason):
    return {'status': 'NOT_TESTED', 'reason': reason}


def validate_result(result, request):
    exact_keys(result, ['schema', 'runId', 'caseId', 'infrastructure', 'assertions', 'lifecycle', 'evidence'],
               ['schema', 'runId', 'caseId', 'infrastructure', 'assertions', 'lifecycle', 'evidence'])
    require(result['schema'] == 1 and result['runId'] == request['runId'] and result['caseId'] == request['caseId'], 'Stale or wrong native result identity')
    def check(row):
        exact_keys(row, ['status', 'reason', 'actual'], ['status', 'reason'])
        require(isinstance(row['status'], str) and row['status'] in STATUSES and isinstance(row['reason'], str) and row['reason'].strip(), 'Each check needs string status and nonempty reason')
    check(result['infrastructure'])
    lifecycle = result['lifecycle']
    exact_keys(lifecycle, ['status', 'reason', 'verifiedExited', 'leaseReleased'], ['status', 'reason', 'verifiedExited', 'leaseReleased'])
    check({k: v for k, v in lifecycle.items() if k in ('status', 'reason')})
    require(type(lifecycle['verifiedExited']) is bool and type(lifecycle['leaseReleased']) is bool, 'Explicit lifecycle booleans required')
    if lifecycle['status'] == 'PASS' and not (lifecycle['verifiedExited'] and lifecycle['leaseReleased']):
        lifecycle['status'] = 'NOT_TESTED'
        lifecycle['reason'] = 'Closure flags incomplete; ' + lifecycle['reason']
    require(isinstance(result['assertions'], dict) and len(result['assertions']) <= 256, 'Assertions must be bounded map')
    for row in result['assertions'].values():
        check(row)
    # The coordinator adds absent requirements; it never invents a passing check.
    for assertion in request['assertions']:
        result['assertions'].setdefault(assertion, not_tested('Adapter provided no measurement'))
    strings(result['evidence'], 'evidence', 1)
    evidence = [file_identity(resolve(Path(request['attemptDir']), p)) for p in result['evidence']]
    # All evidence must have already been durably saved before result publication.
    result['evidence'] = evidence
    return result


def verdict(result, required):
    if result['infrastructure']['status'] != 'PASS':
        return 'NOT_TESTED'
    checks = [result['assertions'][name]['status'] for name in required]
    if 'FAIL' in checks:
        return 'FAIL'
    if 'NOT_TESTED' in checks:
        return 'NOT_TESTED'
    return 'PASS'


def can_continue(result):
    life = result['lifecycle']
    return result['infrastructure']['status'] == 'PASS' and life['status'] == 'PASS' and life['verifiedExited'] and life['leaseReleased']


def verify_pins(planned):
    require(sha(planned['job']) == planned['jobSha256'], 'Job changed after planning')
    require(sha(TEMPLATES) == planned['templateSha256'], 'Template changed after planning')
    for pin in [*planned['pins'], planned['executable'], planned['coordinator']]:
        require(sha(pin['path']) == pin['sha256'], 'Input changed during batch: ' + pin['path'])


def run(job, output, execute=False, stop_file=None, only=None):
    planned = plan(job)
    selected = set(only or [c['id'] for c in planned['cases']])
    require(selected <= {c['id'] for c in planned['cases']}, 'Unknown selected case')
    if not execute:
        return planned
    output = Path(output).resolve()
    require(not output.exists() and not output.is_symlink(), 'Fresh batch output required; preserve prior attempts')
    ancestor = output.parent
    while not ancestor.exists():
        ancestor = ancestor.parent
    require(shutil.disk_usage(ancestor.resolve()).free >= 2 * 1024**3, 'Batch output filesystem needs at least 2 GiB free; select another output root')
    output.mkdir(parents=True)
    save(output / 'plan.json', planned)
    stop_file = Path(stop_file).resolve() if stop_file else output / 'STOP'
    started = time.monotonic()
    summary = {'schema': 1, 'output': str(output), 'startedUtc': utc(), 'jobSha256': planned['jobSha256'], 'template': planned['template'],
               'status': 'NOT_TESTED', 'cases': [], 'attempted': [], 'stopReason': None, 'automaticRetries': 0}
    interrupted = False
    def on_signal(*_):
        nonlocal interrupted
        interrupted = True
    old = {sig: signal.signal(sig, on_signal) for sig in (signal.SIGINT, signal.SIGTERM)}
    try:
        for case in planned['cases']:
            if case['id'] not in selected:
                continue
            if interrupted or stop_file.exists():
                summary['stopReason'] = 'Cancellation before next case'
                break
            try:
                verify_pins(planned)
            except (WorkflowError, OSError) as error:
                summary['stopReason'] = str(error)
                break
            attempt = output / case['id']
            attempt.mkdir()
            run_id = str(uuid.uuid4())
            request = {'schema': 1, 'runId': run_id, 'caseId': case['id'], 'template': planned['template'],
                       'project': planned['project'], 'world': planned['world'], 'attemptDir': str(attempt),
                       'assertions': case['assertions'], 'parameters': case['parameters'], 'capabilities': planned['capabilities']}
            request_path, result_path, cancel_path = [attempt / name for name in ('request.json', 'adapter-result.json', 'CANCEL')]
            save(request_path, request)
            values = {'{script}': planned['script'], '{request}': str(request_path), '{result}': str(result_path), '{cancel}': str(cancel_path)}
            command = [planned['executable']['path'], *[values.get(v, v) for v in planned['args']]]
            save(attempt / 'command.json', {'argv': command, 'cwd': str(Path(planned['script']).parent)})
            case_started = time.monotonic()
            result = None
            boundary = None
            summary['attempted'].append(case['id'])
            try:
                with (attempt / 'adapter.stdout.log').open('xb') as stdout, (attempt / 'adapter.stderr.log').open('xb') as stderr:
                    # Adapter is trusted local code. No shell, focus, kill, game or lease operation here.
                    child = subprocess.Popen(command, cwd=Path(planned['script']).parent, stdout=stdout, stderr=stderr,
                                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    save(attempt / 'adapter-owner.json', {'pid': child.pid, 'startedUtc': utc(), 'argv': command,
                                                         'controlAllowed': False, 'reason': 'Diagnostic reference only; PID alone never authorizes process control'})
                    cancel_at = None
                    while child.poll() is None:
                        oversized = any((attempt / name).stat().st_size > MAX_ADAPTER_LOG_BYTES for name in ('adapter.stdout.log', 'adapter.stderr.log'))
                        if cancel_at is None and (oversized or interrupted or stop_file.exists() or time.monotonic() - case_started >= planned['timeoutSeconds']):
                            boundary = 'adapter-log-limit' if oversized else 'cancelled' if interrupted or stop_file.exists() else 'deadline'
                            save(cancel_path, {'runId': run_id, 'reason': boundary, 'utc': utc()})
                            cancel_at = time.monotonic()
                        if cancel_at is not None and time.monotonic() - cancel_at >= planned['closeGraceSeconds']:
                            boundary += ': adapter still alive; preserve ownership, request human handoff'
                            break
                        time.sleep(.1)
                    exited = child.poll() is not None
                    exit_code = child.returncode if exited else None
                if any((attempt / name).stat().st_size > MAX_ADAPTER_LOG_BYTES for name in ('adapter.stdout.log', 'adapter.stderr.log')):
                    boundary = boundary or 'adapter-log-limit'
                if exited and result_path.exists():
                    result = validate_result(read_json(result_path), request)
                else:
                    raise WorkflowError('Adapter result missing or adapter remains alive')
                # Neither exit 0 nor a result file is accepted after a censored boundary.
                if boundary:
                    result['infrastructure'] = not_tested(boundary)
                elif exit_code not in (0, 1, 2):
                    result['infrastructure'] = not_tested('Adapter exit code: ' + str(exit_code))
                verify_pins(planned)
            except Exception as error:
                # Adapter/protocol failures must leave a truthful attempted case,
                # even for an unexpected exception. Never infer native closure.
                result = {'schema': 1, 'runId': run_id, 'caseId': case['id'], 'infrastructure': not_tested(type(error).__name__ + ': ' + str(error)),
                          'assertions': {name: not_tested('No qualified measurement') for name in case['assertions']},
                          'lifecycle': {**not_tested('Ownership/closure requires inspection'), 'verifiedExited': False, 'leaseReleased': False}, 'evidence': []}
            status = verdict(result, case['assertions'])
            save(attempt / 'result.json', {**result, 'status': status, 'elapsedSeconds': round(time.monotonic() - case_started, 3)})
            row = {'id': case['id'], 'status': status, 'infrastructure': result['infrastructure'], 'lifecycle': result['lifecycle'],
                   'result': (attempt / 'result.json').relative_to(output).as_posix(), 'elapsedSeconds': round(time.monotonic() - case_started, 3)}
            summary['cases'].append(row)
            print(json.dumps(row), flush=True)
            if not can_continue(result) or boundary:
                summary['stopReason'] = boundary or 'Infrastructure or lifecycle incomplete; no next case'
                break
    finally:
        for sig, previous in old.items():
            signal.signal(sig, previous)
        completed = {row['id'] for row in summary['cases']}
        summary['notStarted'] = sorted(selected - set(summary['attempted']))
        summary['incomplete'] = sorted(set(summary['attempted']) - completed)
        if summary['incomplete']:
            summary['stopReason'] = summary['stopReason'] or 'Attempt interrupted before durable normalized result; inspect ownership'
        statuses = [r['status'] for r in summary['cases']]
        summary['status'] = ('FAIL' if 'FAIL' in statuses else 'NOT_TESTED' if not statuses or summary['stopReason'] or summary['notStarted'] or 'NOT_TESTED' in statuses else 'PASS')
        summary['completedUtc'] = utc()
        summary['elapsedSeconds'] = round(time.monotonic() - started, 3)
        save(output / 'summary.json', summary)
        lines = ['# Batch evidence', '', f"Result: **{summary['status']}**. Time: {summary['elapsedSeconds']} s. Automatic retries: 0.", '',
                 '| Case | Result | Infrastructure | Lifecycle | Evidence |', '|---|---|---|---|---|']
        for row in summary['cases']:
            lines.append(f"| {row['id']} | {row['status']} | {row['infrastructure']['status']} | {row['lifecycle']['status']} | [result]({row['result']}) |")
        lines += ['', 'Stop reason: ' + str(summary['stopReason']), '', 'Not started: ' + ', '.join(summary['notStarted']), '',
                  'Incomplete attempts: ' + ', '.join(summary['incomplete']), '',
                  'A behavior PASS does not erase a lifecycle failure. Review required measurements and hashed evidence in each result.']
        (output / 'index.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return summary


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('templates', help='Task-to-template catalog')
    p = sub.add_parser('bindings', help='Discover machine-local addon workflow bindings; never launch')
    p.add_argument('--registry', type=Path, default=REGISTRY)
    p = sub.add_parser('init', help='Create a local job; adapter remains addon-owned')
    p.add_argument('--template', required=True, choices=list(read_json(TEMPLATES)))
    p.add_argument('--project', required=True)
    p.add_argument('--world', required=True)
    p.add_argument('--adapter', required=True)
    p.add_argument('--executable', required=True)
    p.add_argument('--addons-root', action='append', required=True)
    p.add_argument('--required-class', action='append', default=[])
    p.add_argument('--case', action='append', default=[])
    p.add_argument('--output', required=True)
    p = sub.add_parser('plan', help='Check inputs and adapter capabilities; never launch')
    choice = p.add_mutually_exclusive_group(required=True)
    choice.add_argument('--job')
    choice.add_argument('--binding')
    p.add_argument('--registry', type=Path, default=REGISTRY)
    p = sub.add_parser('run', help='Sequential native batch through an addon-owned adapter')
    choice = p.add_mutually_exclusive_group(required=True)
    choice.add_argument('--job')
    choice.add_argument('--binding')
    p.add_argument('--registry', type=Path, default=REGISTRY)
    p.add_argument('--output')
    p.add_argument('--execute', action='store_true')
    p.add_argument('--stop-file')
    p.add_argument('--case', action='append')
    args = parser.parse_args(argv)
    try:
        if args.command == 'templates':
            result = read_json(TEMPLATES)
        elif args.command == 'bindings':
            result = bindings(args.registry)
        elif args.command == 'init':
            template = read_json(TEMPLATES)[args.template]
            script = Path(args.adapter).resolve()
            prefix = ['-NoProfile', '-NonInteractive', '-File'] if script.suffix.lower() == '.ps1' else []
            result = {'schema': 1, 'template': args.template, 'project': str(Path(args.project).resolve()), 'world': args.world,
                      'sourceRoots': [str(Path(args.project).resolve().parent)], 'addonRoots': [str(Path(v).resolve()) for v in args.addons_root],
                      'requiredFiles': [], 'requiredClasses': args.required_class, 'capabilities': template['capabilities'],
                      'adapter': {'executable': str(Path(args.executable).resolve()), 'script': str(script),
                                  'args': [*prefix, '{script}', '{request}', '{result}', '{cancel}']},
                      'cases': [{'id': name, 'parameters': {}, 'assertions': template['requiredAssertions']} for name in args.case or ['smoke']],
                      'timeoutSeconds': 180, 'closeGraceSeconds': 30,
                      'notes': 'Review adapter capabilities, requiredFiles, case parameters and recommended assertions before execution.'}
            save(args.output, result)
        elif args.command == 'plan':
            job, _ = selected_job(args)
            result = plan(job)
        else:
            job, output_root = selected_job(args)
            require(args.output or output_root, '--job requires --output; a local binding may declare outputRoot')
            output = args.output or Path(output_root) / args.binding / (dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex)
            result = run(job, output, args.execute, args.stop_file, args.case)
        print(json.dumps(result, indent=2, allow_nan=False))
        return 1 if result.get('status') == 'FAIL' else 2 if args.command == 'run' and args.execute and result.get('status') == 'NOT_TESTED' else 0
    except (OSError, ValueError) as error:
        print(json.dumps({'status': 'NOT_TESTED', 'reason': str(error)}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
