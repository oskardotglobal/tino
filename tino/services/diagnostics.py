'''Parsing of Typst CLI diagnostics into structured, editor-friendly records.

The Typst CLI is invoked with ``--diagnostic-format short``, which emits one
diagnostic per line as ``path:line:column: severity: message``. Paths are
printed relative to the working directory, which is always the bucket root, so
they map directly onto the paths the editor knows.
'''

import re
from pathlib import Path

_LOCATED = re.compile(
    r'^(?P<path>[^:]*[^:\s][^:]*):(?P<line>\d+):(?P<column>\d+): '
    r'(?P<severity>error|warning): (?P<message>.*)$',
)

_BARE = re.compile(r'^(?P<severity>error|warning): (?P<message>.*)$')

_HINT = re.compile(r'^\s*(?:hint|help):\s*(?P<message>.*)$')


def parse_diagnostics(stderr, root=None):
    '''Turn a Typst CLI stderr blob into a list of diagnostic dictionaries.

    Each diagnostic is ``{path, line, column, severity, message}``, where
    ``path`` is bucket-relative (or ``None`` for diagnostics without a
    location) and ``line``/``column`` are 1-based (or ``None``).
    Hint lines are folded into the message of the diagnostic they follow.
    '''
    diagnostics = []

    for line in (stderr or '').splitlines():
        text = line.rstrip()

        if not text.strip():
            continue

        _consume_line(diagnostics, text, root)

    return diagnostics


def has_errors(diagnostics):
    '''Whether any of the diagnostics is an error (as opposed to a warning).'''
    return any(diag['severity'] == 'error' for diag in diagnostics)


# ── Internal ──


def _consume_line(diagnostics, text, root):
    '''Append one stderr line to the diagnostics, folding hints into the last one.'''
    located = _LOCATED.match(text)

    if located:
        diagnostics.append(_from_match(located, root))
        return

    bare = _BARE.match(text)

    if bare:
        diagnostics.append({
            'column': None,
            'line': None,
            'message': bare['message'].strip(),
            'path': None,
            'severity': bare['severity'],
        })
        return

    hint = _HINT.match(text)

    if hint and diagnostics:
        diagnostics[-1]['message'] += f"\nhint: {hint['message'].strip()}"
        return

    if diagnostics:
        diagnostics[-1]['message'] += f'\n{text.strip()}'
    else:
        diagnostics.append({
            'column': None,
            'line': None,
            'message': text.strip(),
            'path': None,
            'severity': 'error',
        })


def _from_match(match, root):
    '''Build a diagnostic dictionary from a matched ``path:line:column`` line.'''
    return {
        'column': int(match['column']),
        'line': int(match['line']),
        'message': match['message'].strip(),
        'path': _relative_path(match['path'].strip(), root),
        'severity': match['severity'],
    }


def _relative_path(path, root):
    '''Normalise a diagnostic path to a bucket-relative one where possible.'''
    if not root:
        return path

    candidate = Path(path)

    if candidate.is_absolute():
        try:
            return str(candidate.relative_to(Path(root).resolve()))
        except ValueError:
            return path

    return path.removeprefix('./')
