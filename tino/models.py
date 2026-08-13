'''Pydantic models for API request/response schemas.'''

from typing import Annotated

from pydantic import BaseModel, Field, model_validator

# ── Auth ──


class User(BaseModel):
    '''Authenticated user with group memberships.'''
    username: str
    email: str
    groups: list[str]
    api_key_access: dict[str, str] | None = None
    '''Per-bucket role map for API key authenticated requests (``None`` for OIDC users).'''


class Profile(BaseModel):
    '''Optional display name and email a user is credited with in commits.'''
    name: str = Field('', max_length=100)
    email: str = Field('', max_length=100)


# ── Buckets ──


class AccessEntry(BaseModel):
    '''Grants a role within a bucket to either an OIDC group or a single user.

    Exactly one of ``group`` or ``user`` must be set. Entries stored before
    single-user sharing existed only carry ``group``, so they keep parsing.
    '''
    group: str = ''
    user: str = ''
    role: str  # viewer | editor | committer

    @model_validator(mode='after')
    def _exactly_one_subject(self) -> 'AccessEntry':
        '''Reject entries naming both a group and a user, or neither.'''
        if bool(self.group) == bool(self.user):
            raise ValueError('Set exactly one of "group" or "user"')
        return self


Slug = Annotated[str, Field(pattern=r'^[a-z0-9]+(?:-[a-z0-9]+)*$', min_length=1, max_length=50)]


class BucketCreate(BaseModel):
    '''Request body for creating a new bucket.

    The creator becomes the owner; there is no owner field to spoof.
    '''
    slug: Slug
    name: str = Field('', max_length=50)
    description: str = ''
    remote: str = ''
    access: list[AccessEntry] = []


class BucketUpdate(BaseModel):
    '''Request body for updating bucket metadata. Omitted fields are unchanged.'''
    name: str | None = Field(None, max_length=50)
    description: str | None = None
    remote: str | None = None
    access: list[AccessEntry] | None = None
    owner: str | None = Field(None, max_length=100)
    '''Transfers ownership. Only an administrator or the current owner may set it.'''


class BucketInfo(BaseModel):
    '''Bucket metadata returned by the API.'''
    slug: str
    name: str = ''
    description: str
    remote: str = ''
    owner: str = ''
    '''Username of the owner, or empty for buckets created before ownership existed.'''
    access: list[AccessEntry]


# ── Files ──


class FileCreate(BaseModel):
    '''Request body for creating a new file in a bucket.'''
    path: str
    content: str = ''


class FileSave(BaseModel):
    '''Request body for saving file content.'''
    content: str


class FileEntry(BaseModel):
    '''Single entry in a file listing.'''
    path: str
    type: str  # file | directory


# ── Editor tooling ──

# Positions are LSP-shaped, which is also how CodeMirror reports them: a
# zero-based line plus a zero-based character offset in UTF-16 code units.


class Position(BaseModel):
    '''A caret position in a document.'''
    line: int = Field(ge=0)
    character: int = Field(ge=0)


class Span(BaseModel):
    '''A range of text in a document.'''
    start: Position
    end: Position


class CompletionRequest(BaseModel):
    '''Request body asking what may be typed at a position.'''
    position: Position


class CodeActionRequest(BaseModel):
    '''Request body asking which code actions apply to a range.'''
    span: Span


class TextEdit(BaseModel):
    '''One replacement in a document, as offered by a code action.'''
    range: Span
    new_text: str
    snippet: bool = False


class EditRequest(BaseModel):
    '''Request body applying a code action's edits, keyed by bucket path.'''
    files: dict[str, list[TextEdit]]


# ── Search ──


class SearchSnippet(BaseModel):
    '''A single content line that matched a search query.'''
    line: int
    text: str


class SearchResult(BaseModel):
    '''A file whose name and/or content matched a search query.'''
    bucket: str
    path: str
    name_match: bool = False
    snippets: list[SearchSnippet] = []


# ── Git ──


class CommitRequest(BaseModel):
    '''Request body for committing selected files.'''
    files: list[str]
    message: str


class CommitInfo(BaseModel):
    '''Metadata for a single git commit.'''
    sha: str
    message: str
    author: str
    timestamp: str
    deleted: bool = False


class FileStatus(BaseModel):
    '''Git status of a single file in the working tree.'''
    path: str
    status: str  # modified | untracked | deleted


class DiffEntry(BaseModel):
    '''Unified diff output for a single file.'''
    path: str
    diff: str


class RestoreRequest(BaseModel):
    '''Request body for restoring files from a specific commit.'''
    ref: str
    paths: list[str]


class RemoteResult(BaseModel):
    '''Result of a push or pull against the bucket's remote.'''
    output: str
    changed: list[str] = []
    '''File paths updated by a pull (always empty for a push).'''


# ── Templates ──


class TemplateInit(BaseModel):
    '''Request body for initializing a bucket from a Typst template.'''
    name: str
    namespace: str = 'preview'
    version: str
    target_dir: str = ''


# ── API Keys ──


class ApiKeyInfo(BaseModel):
    '''API key metadata returned by the API (no raw token or hash).'''
    id: str
    label: str
    created: str
    access: dict[str, str]


class ApiKeyCreate(BaseModel):
    '''Request body for creating or updating an API key.'''
    label: str
    access: dict[str, str] = {}


class ApiKeyCreated(BaseModel):
    '''Response when an API key is first created — includes the raw token (shown once only).'''
    token: str
    id: str
    label: str
    created: str
    access: dict[str, str]


# ── Fonts ──


class FontEntry(BaseModel):
    '''Metadata for an installed font file.'''
    filename: str
    size: int
