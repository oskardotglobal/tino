import { StreamLanguage, tags } from './vendor/codemirror.js'
import { codeToken, eatString, mathToken } from './codemirror-typst-code.js'
import { SINGLE_ITEM } from './constants.js'

/**
 * Typst stream tokenizer. A regex-based state machine — no real parser — whose
 * state is a stack of mode frames: markup, code (after `#` or inside `{…}`),
 * math (`$…$`), raw blocks and block comments. Code and math live in
 * codemirror-typst-code.js; this file owns markup and the mode dispatch.
 *
 * Token names map to Lezer highlight tags via tokenTable below, and from there
 * to the `cm-typst-*` classes styled in styles.css.
 */

const HEADING = /^={1,6}(?=\s)/u
const LIST_MARKER = /^(?:[-+]|\d+\.)(?=\s)/u
const TERM_MARKER = /^\/(?=\s)/u
const LABEL = /^<[\p{L}\p{N}_:.-]+>/u
const REF = /^@[\p{L}][\p{L}\p{N}_-]*/u
const URL = /^https?:\/\/\S+/u
const RAW_LANG = /^[\p{L}\p{N}_+-]+/u
const SYMBOL_SHORTHAND = /^(?:---|--|\.\.\.|~)/u
const PLAIN = /[^\s\\#$*_`<@/[\]"~-]/u
const KEYWORD_AHEAD =
  /^(?:let|set|show|import|include|context|if|else|for|while|return|not)\b/u

const _startState = () => ({ inString: false, stack: [{ mode: 'markup' }] })

const _top = state => state.stack[state.stack.length - SINGLE_ITEM]

const _inBlockComment = (stream, state) => {
  while (!stream.eol()) {
    if (stream.match('*/')) {
      state.stack.pop()
      return 'comment'
    }
    stream.next()
  }
  return 'comment'
}

const _inRawBlock = (stream, state) => {
  if (stream.sol() && state.rawLang) {
    state.rawLang = false
    if (stream.match(RAW_LANG))
      return 'property'
  }
  while (!stream.eol()) {
    if (stream.match('```')) {
      state.stack.pop()
      return 'raw'
    }
    stream.next()
  }
  return 'raw'
}

const _eatInlineRaw = stream => {
  while (!stream.eol()) {
    if (stream.eat('`'))
      return 'raw'
    stream.next()
  }
  return 'raw'
}

/* Bold/italic runs stop at the closing delimiter or the end of the line —
   Typst does not let them span a paragraph break either. */

const _eatWrapped = (stream, delim, tagName) => {
  while (!stream.eol()) {
    const ch = stream.next()
    if (ch === '\\')
      stream.next()
    else if (ch === delim)
      return tagName
  }
  return tagName
}

const _tryComment = (stream, state) => {
  if (stream.match('//')) {
    stream.skipToEnd()
    return 'comment'
  }
  if (stream.match('/*')) {
    state.stack.push({ mode: 'blockComment' })
    return _inBlockComment(stream, state)
  }
  return null
}

const _tryRaw = (stream, state) => {
  if (stream.match('```')) {
    state.rawLang = true
    state.stack.push({ mode: 'rawBlock' })
    if (stream.match(RAW_LANG)) {
      state.rawLang = false
      return 'property'
    }
    return 'raw'
  }
  if (stream.eat('`'))
    return _eatInlineRaw(stream)
  return null
}

const _tryLineStart = (stream, state) => {
  if (!stream.sol())
    return null
  stream.eatSpace()
  if (stream.match(HEADING)) {
    state.heading = true
    return 'marker'
  }
  if (stream.match(LIST_MARKER) || stream.match(TERM_MARKER))
    return 'marker'
  return null
}

/* The `#` sigil is coloured like what follows it: red with a statement
   keyword (#let, #show, …), a neutral marker before a call or a value. */

const _hashToken = stream =>
  KEYWORD_AHEAD.test(stream.string.slice(stream.pos)) ? 'keyword' : 'marker'

const _tryEnterMode = (stream, state) => {
  if (stream.eat('#')) {
    state.stack.push({ block: false, depth: 0, mode: 'code' })
    return _hashToken(stream)
  }
  if (stream.eat('$')) {
    state.stack.push({ depth: 0, mode: 'math' })
    return 'marker'
  }
  return null
}

const _tryEmphasis = stream => {
  if (stream.eat('*'))
    return _eatWrapped(stream, '*', 'strong')
  if (stream.eat('_'))
    return _eatWrapped(stream, '_', 'emphasis')
  return null
}

const _tryPattern = (stream, state) => {
  if (stream.match(URL))
    return 'link'
  if (stream.match(LABEL))
    return 'label'
  if (stream.match(REF))
    return 'ref'
  if (stream.eat('"'))
    return eatString(stream, state)
  if (stream.match(SYMBOL_SHORTHAND))
    return 'escape'
  return null
}

const _escapeToken = stream => {
  stream.next()
  return 'escape'
}

const _closeBlock = state => {
  state.stack.pop()
  return 'bracket'
}

/* Consume a run of ordinary text in one go — everything up to the next
   character that could start markup — instead of one token per character. */

const _plainToken = (stream, state) => {
  if (!stream.eatWhile(PLAIN))
    stream.next()
  return state.heading ? 'heading' : null
}

const _markupToken = (stream, state) => {
  if (stream.eatSpace())
    return state.heading ? 'heading' : null
  if (stream.eat('\\'))
    return _escapeToken(stream)
  if (_top(state).nested && stream.eat(']'))
    return _closeBlock(state)
  return _tryComment(stream, state)
    || _tryRaw(stream, state)
    || _tryEnterMode(stream, state)
    || _tryEmphasis(stream)
    || _tryPattern(stream, state)
    || _plainToken(stream, state)
}

const _modeToken = (stream, state) => {
  const frame = _top(state)
  if (frame.mode === 'blockComment')
    return _inBlockComment(stream, state)
  if (frame.mode === 'rawBlock')
    return _inRawBlock(stream, state)
  if (frame.mode === 'code')
    return codeToken(stream, state, frame)
  if (frame.mode === 'math')
    return mathToken(stream, state)
  return _markupToken(stream, state)
}

/*
 * Strings and heading runs never continue onto the next line, so both flags are
 * cleared at every line start. Code expressions end there too unless a bracket
 * is still open, so balanced code frames are dropped as well — otherwise a line
 * ending inside a string (which returns before the usual end-of-expression
 * check) would leave the rest of the document in code mode.
 */

const _resetLine = state => {
  state.inString = false
  state.heading = false
  while (_top(state).mode === 'code' && _top(state).depth === 0)
    state.stack.pop()
}

const _token = (stream, state) => {
  if (stream.sol())
    _resetLine(state)
  const lineStart = _top(state).mode === 'markup' && _tryLineStart(stream, state)
  return lineStart || _modeToken(stream, state)
}

export const typstLanguage = StreamLanguage.define({
  languageData: {
    closeBrackets: { brackets: ['(', '[', '{', '"', '$'] },
    commentTokens: { block: { close: '*/', open: '/*' }, line: '//' },
    indentOnInput: /^\s*[}\])]$/u,
  },
  name: 'typst',
  startState: _startState,
  token: _token,
  tokenTable: {
    atom: tags.atom,
    bracket: tags.bracket,
    comment: tags.comment,
    emphasis: tags.emphasis,
    escape: tags.escape,
    function: tags.function(tags.variableName),
    heading: tags.heading,
    keyword: tags.keyword,
    label: tags.labelName,
    link: tags.url,
    marker: tags.processingInstruction,
    number: tags.number,
    operator: tags.operator,
    property: tags.propertyName,
    punctuation: tags.punctuation,
    raw: tags.monospace,
    ref: tags.special(tags.labelName),
    string: tags.string,
    strong: tags.strong,
    variable: tags.variableName,
  },
})
