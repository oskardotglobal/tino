'''Tests for CompilerService: command building, path safety, caching and error handling.

The ``typst``-marked tests run the real CLI and are skipped when it is missing.
'''

import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

from tino.services.compiler import CompileError, CompilerService, _Document, _Options
from tino.services.diagnostics import parse_diagnostics

needs_typst = pytest.mark.skipif(shutil.which('typst') is None, reason='typst CLI not installed')


@pytest.fixture
def compiler(data_dir, tmp_path):
    return CompilerService(data_dir, cache_dir=tmp_path / 'cache')


def _doc(root):
    return _Document(slug='b', path='src.typ', root=root, source=root / 'src.typ')


def _fake_run(pages=1, returncode=0, stderr=''):
    '''A subprocess.run stand-in that writes fake SVG/PDF output.'''
    calls = []

    def fake_run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        output = cmd[-1]
        if returncode == 0:
            if '--deps' in cmd:
                deps = {'inputs': [cmd[cmd.index('--root') + 2]]}
                Path(cmd[cmd.index('--deps') + 1]).write_text(json.dumps(deps))
            if '{0p}' in output:
                for n in range(1, pages + 1):
                    name = output.replace('{0p}', str(n)).replace('{t}', str(pages))
                    Path(name).write_text(f'<svg>{n}</svg>')
            else:
                Path(output).write_bytes(b'%PDF')
        return SimpleNamespace(returncode=returncode, stderr=stderr, stdout='')

    return fake_run, calls


# ── command building ──

def test_build_cmd_minimal(compiler, tmp_path):
    doc = _doc(tmp_path)
    cmd = compiler._build_cmd(doc, 'out.pdf', _Options())  # pylint: disable=protected-access
    assert cmd == ['typst', 'compile', '--diagnostic-format', 'short',
                   '--root', str(tmp_path), str(doc.source), 'out.pdf']


def test_build_cmd_full(tmp_path):
    fonts = tmp_path / 'fonts'
    fonts.mkdir()
    svc = CompilerService(tmp_path, tmp_path / 'pkgs', fonts)
    options = _Options(fmt='svg', pages='1', deps=tmp_path / 'deps.json')
    cmd = svc._build_cmd(_doc(tmp_path), 'o', options)  # pylint: disable=protected-access
    assert cmd[cmd.index('--format') + 1] == 'svg'
    assert cmd[cmd.index('--pages') + 1] == '1'
    assert cmd[cmd.index('--deps') + 1] == str(tmp_path / 'deps.json')
    assert cmd[cmd.index('--package-path') + 1] == str(tmp_path / 'pkgs')
    assert cmd[cmd.index('--font-path') + 1] == str(fonts)


def test_build_cmd_html_enables_feature(compiler, tmp_path):
    cmd = compiler._build_cmd(_doc(tmp_path), 'o', _Options(fmt='html'))  # pylint: disable=protected-access
    assert cmd[cmd.index('--features') + 1] == 'html'


def test_build_cmd_skips_missing_font_dir(tmp_path):
    svc = CompilerService(tmp_path, font_dir=tmp_path / 'missing')
    assert '--font-path' not in svc._build_cmd(_doc(tmp_path), 'o', _Options())  # pylint: disable=protected-access


# ── source resolution ──

def test_missing_source(compiler, bucket):
    with pytest.raises(FileNotFoundError):
        compiler.compile_document(bucket, 'ghost.typ')


def test_traversal_source(compiler, bucket, data_dir):
    (data_dir / 'outside.typ').write_text('x')
    with pytest.raises(FileNotFoundError, match='outside the bucket'):
        compiler.compile_pdf(bucket, '../outside.typ')


# ── compile (mocked typst) ──

def test_compile_document_returns_pages_in_order(compiler, files, bucket, monkeypatch):
    files.write(bucket, 'a.typ', 'x')
    fake_run, calls = _fake_run(pages=3)
    monkeypatch.setattr(subprocess, 'run', fake_run)

    result = compiler.compile_document(bucket, 'a.typ')
    assert result['ok'] is True
    assert result['count'] == 3
    assert result['pages'] == {'1': '<svg>1</svg>', '2': '<svg>2</svg>', '3': '<svg>3</svg>'}
    _, kwargs = calls[0]
    assert kwargs['cwd'] == str((compiler.data_dir / bucket).resolve())
    assert kwargs['timeout'] > 0


def test_compile_document_is_served_from_cache(compiler, files, bucket, monkeypatch):
    files.write(bucket, 'a.typ', 'x')
    fake_run, calls = _fake_run(pages=2)
    monkeypatch.setattr(subprocess, 'run', fake_run)

    first = compiler.compile_document(bucket, 'a.typ')
    second = compiler.compile_document(bucket, 'a.typ')
    assert len(calls) == 1
    assert second['pages'] == first['pages']


def test_compile_pdf_returns_temp_file(compiler, files, bucket, monkeypatch):
    files.write(bucket, 'a.typ', 'x')
    monkeypatch.setattr(subprocess, 'run', _fake_run()[0])
    pdf = compiler.compile_pdf(bucket, 'a.typ')
    try:
        assert pdf.read_bytes() == b'%PDF'
    finally:
        pdf.unlink()


def test_compile_error_is_reported_not_raised(compiler, files, bucket, monkeypatch):
    files.write(bucket, 'a.typ', 'x')
    monkeypatch.setattr(subprocess, 'run', _fake_run(returncode=1, stderr='error: boom')[0])
    result = compiler.compile_document(bucket, 'a.typ')
    assert result['ok'] is False
    assert result['diagnostics'][0]['message'] == 'boom'


def test_compile_pdf_error_cleans_temp_file(compiler, files, bucket, monkeypatch):
    files.write(bucket, 'a.typ', 'x')
    fake_run, calls = _fake_run(returncode=1)
    monkeypatch.setattr(subprocess, 'run', fake_run)
    with pytest.raises(RuntimeError, match='Compilation failed'):
        compiler.compile_pdf(bucket, 'a.typ')
    assert not Path(calls[0][0][-1]).exists()


def test_version(monkeypatch):
    monkeypatch.setattr(subprocess, 'run',
                        lambda *a, **k: SimpleNamespace(stdout='typst 0.15.1\n'))
    assert CompilerService.version() == 'typst 0.15.1'


# ── diagnostics ──

TYPST_STDERR = '''\
main.typ:3:2: error: unknown variable: foo
lib/util.typ:12:10: warning: unused import
'''


def test_parse_diagnostics_errors_and_warnings():
    assert parse_diagnostics(TYPST_STDERR) == [
        {'severity': 'error', 'message': 'unknown variable: foo',
         'path': 'main.typ', 'line': 3, 'column': 2},
        {'severity': 'warning', 'message': 'unused import',
         'path': 'lib/util.typ', 'line': 12, 'column': 10},
    ]


def test_parse_diagnostics_without_location():
    assert parse_diagnostics('error: failed to load file (access denied)') == [
        {'severity': 'error', 'message': 'failed to load file (access denied)',
         'path': None, 'line': None, 'column': None},
    ]


def test_parse_diagnostics_folds_hints():
    [diag] = parse_diagnostics('a.typ:1:1: error: boom\nhint: try this\n')
    assert diag['message'] == 'boom\nhint: try this'


def test_parse_diagnostics_relativises_absolute_paths(tmp_path):
    [diag] = parse_diagnostics(f'{tmp_path}/sub/a.typ:2:4: error: boom', tmp_path)
    assert (diag['path'], diag['line'], diag['column']) == ('sub/a.typ', 2, 4)


def test_parse_diagnostics_path_with_spaces():
    [diag] = parse_diagnostics('my docs/a.typ:7:3: error: x')
    assert (diag['path'], diag['line'], diag['column']) == ('my docs/a.typ', 7, 3)


@pytest.mark.parametrize('stderr', ['', '\n  \n'])
def test_parse_diagnostics_nothing_to_parse(stderr):
    assert parse_diagnostics(stderr) == []


def test_compile_error_is_runtime_error():
    exc = CompileError('Compilation failed', [])
    assert isinstance(exc, RuntimeError)
    assert exc.diagnostics == []


def test_compile_pdf_error_has_diagnostics(compiler, files, bucket, monkeypatch):
    files.write(bucket, 'a.typ', 'x')
    monkeypatch.setattr(subprocess, 'run', _fake_run(returncode=1, stderr=TYPST_STDERR)[0])
    with pytest.raises(CompileError) as exc:
        compiler.compile_pdf(bucket, 'a.typ')
    assert [d['severity'] for d in exc.value.diagnostics] == ['error', 'warning']


# ── real typst ──

@needs_typst
@pytest.mark.typst
def test_real_compile_document(compiler, files, bucket):
    files.write(bucket, 'a.typ', '= Hello\n#pagebreak()\nWorld')
    result = compiler.compile_document(bucket, 'a.typ')
    assert result['count'] == 2
    assert all(p.lstrip().startswith('<svg') for p in result['pages'].values())


@needs_typst
@pytest.mark.typst
def test_real_compile_pdf(compiler, files, bucket):
    files.write(bucket, 'a.typ', 'Hello')
    pdf = compiler.compile_pdf(bucket, 'a.typ')
    try:
        assert pdf.read_bytes().startswith(b'%PDF')
    finally:
        pdf.unlink()


@needs_typst
@pytest.mark.typst
def test_real_compile_error(compiler, files, bucket):
    files.write(bucket, 'a.typ', 'ok\n#undefined-function()')
    result = compiler.compile_document(bucket, 'a.typ')
    assert result['ok'] is False
    [diag] = [d for d in result['diagnostics'] if d['severity'] == 'error']
    assert (diag['path'], diag['line']) == ('a.typ', 2)
