'''Typst formatter service. Shells out to the `typstyle` binary to pretty-print sources.'''

import logging
import subprocess

from .versions import tool_version

logger = logging.getLogger(__name__)

_FORMAT_TIMEOUT = 15


class FormatterService:
    '''Formats Typst markup by piping it through the typstyle CLI.'''

    def __init__(self, line_width: int = 80, indent_width: int = 2):
        self.line_width = line_width
        self.indent_width = indent_width

    @staticmethod
    def version() -> str | None:
        '''Return the installed typstyle version string, or None when absent.'''
        return tool_version('typstyle')

    def format(self, content: str) -> str:
        '''Return the formatted version of a Typst source string.

        Raises RuntimeError when the source cannot be parsed (with typstyle's
        message), or when the typstyle binary is missing or times out.
        '''
        try:
            result = subprocess.run(
                self._build_cmd(),
                input=content,
                capture_output=True, text=True,
                timeout=_FORMAT_TIMEOUT, check=False,
            )

        except FileNotFoundError as exc:
            raise RuntimeError('typstyle is not installed on the server') from exc

        except subprocess.TimeoutExpired as exc:
            raise RuntimeError('Formatting timed out') from exc

        if result.returncode != 0:
            logger.warning('Formatting failed: %s', result.stderr.strip())
            raise RuntimeError(result.stderr.strip() or 'Formatting failed')

        return result.stdout

    # ── Internal ──

    def _build_cmd(self):
        '''Assemble the typstyle argument list. Without an input path it reads stdin.'''
        return [
            'typstyle',
            '--line-width', str(self.line_width),
            '--indent-width', str(self.indent_width),
        ]
