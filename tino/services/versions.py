'''Version reporting for the external Typst tool chain (typst, typstyle, tinymist).'''

import logging
import subprocess

logger = logging.getLogger(__name__)

_VERSION_TIMEOUT = 10


def tool_version(binary: str) -> str | None:
    '''Return ``binary --version`` as a single line, or None when unavailable.

    typst prints a single version line, while typstyle and tinymist print a
    multi-line build report whose first line is the bare tool name. Their report
    fields are used instead, in descending order of precision.
    '''
    try:
        result = subprocess.run(
            [binary, '--version'],
            capture_output=True, text=True,
            timeout=_VERSION_TIMEOUT, check=True,
        )

    except (OSError, subprocess.SubprocessError):
        logger.info('Could not determine the %s version — is it installed?', binary)
        return None

    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]

    if not lines:
        return None

    for field in ('version:', 'build git describe:'):
        for line in lines:
            if line.lower().startswith(field):
                return f'{binary} {line.split(":", maxsplit=1)[1].strip()}'

    return lines[0]
