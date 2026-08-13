'''Application of LSP text edits to a string.

Language-server edits address the document by zero-based line and UTF-16
character, the same coordinates the editor uses. Both ends are converted to
Python string offsets here, so callers work with plain text.
'''


def apply_edits(text: str, edits: list[dict]) -> str:
    '''Return ``text`` with every edit applied.

    Edits are applied back to front, so an earlier edit's replacement cannot
    shift the positions of a later one. Overlapping edits are a server bug; the
    later one wins.
    '''
    offsets = _line_offsets(text)
    resolved = sorted(
        (
            (
                _offset(text, offsets, edit['range']['start']),
                _offset(text, offsets, edit['range']['end']),
                edit.get('new_text', ''),
            )
            for edit in edits if edit.get('range')
        ),
        reverse=True,
    )
    result = text

    for start, end, new_text in resolved:
        result = result[:start] + new_text + result[max(start, end):]

    return result


def strip_snippet(text: str) -> str:
    '''Turn snippet text into the plain text it describes.

    Snippet placeholders (``${1:Caption}``, ``${2}``, ``$0``) only mean something
    to an editor that can walk a user through them. When an edit is applied to a
    file nobody has open, they are replaced by their default text, or dropped.
    '''
    result = []
    rest = text

    while rest:  # pylint: disable=while-used
        head, marker, tail = rest.partition('$')

        result.append(head)

        if not marker:
            break

        placeholder, rest = _placeholder(tail)
        result.append(placeholder)

    return ''.join(result)


# ── Internal ──


def _placeholder(text: str) -> tuple[str, str]:
    '''Read one placeholder after a ``$`` and return (its text, the remainder).'''
    if text.startswith('{'):
        body, _, rest = text[1:].partition('}')
        _, colon, default = body.partition(':')

        return (default if colon else ''), rest

    digits = 0

    while digits < len(text) and text[digits].isdigit():  # pylint: disable=while-used
        digits += 1

    return '', text[digits:]


def _line_offsets(text: str) -> list[int]:
    '''Return the string offset each line starts at.'''
    offsets = [0]

    for index, char in enumerate(text):
        if char == '\n':
            offsets.append(index + 1)

    return offsets


def _offset(text: str, offsets: list[int], position: dict) -> int:
    '''Convert an LSP position to a string offset, clamped to the text.'''
    line = position.get('line') or 0

    if line >= len(offsets):
        return len(text)

    start = offsets[line]
    end = offsets[line + 1] - 1 if line + 1 < len(offsets) else len(text)

    return min(start + _characters(text[start:end], position.get('character') or 0), end)


def _characters(line: str, character: int) -> int:
    '''Convert an LSP character (a UTF-16 code unit count) to a codepoint count.

    The two differ only beyond the BMP, where one character (an emoji, say)
    counts as two UTF-16 units — but a document holding one would shift every
    edit on its line if that were ignored.
    '''
    units = line.encode('utf-16-le')[:character * 2]

    return len(units.decode('utf-16-le', errors='ignore'))
