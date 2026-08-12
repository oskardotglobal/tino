import { SINGLE_ITEM } from './constants.js'

/**
 * Tokenizers for Typst's code and math modes, driven by the mode stack in
 * codemirror-typst-tokens.js. Code mode covers everything after a `#` (and the
 * inside of `{…}` blocks); math mode covers everything between `$` delimiters.
 */

/** Keywords that open a statement running to the end of the line. */

const BLOCK_KEYWORDS = new Set([
  'context',
  'else',
  'for',
  'if',
  'import',
  'include',
  'let',
  'return',
  'set',
  'show',
  'while',
])

const KEYWORDS = new Set([
  ...BLOCK_KEYWORDS,
  'and',
  'as',
  'break',
  'continue',
  'in',
  'not',
  'or',
])

const ATOMS = new Set(['auto', 'false', 'none', 'true'])

const IDENT_START = /[\p{L}_]/u
const IDENT = /^[\p{L}_][\p{L}\p{N}_-]*/u
const UNIT = /^(?:em|pt|in|cm|mm|fr|deg|rad|%)/u
const NUMBER = /^(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/u
const OPERATOR = /^(?:=>|==|!=|<=|>=|\.\.|[+\-*/=<>%])/u
const PUNCTUATION = /^[,;:.]/u
const CONTINUES = /^[([.,:]/u
const MATH_IDENT = /^\p{L}[\p{L}\p{N}]*/u
const MATH_OPERATOR = /^[&^_]/u
const MATH_BRACKET = /^[(){}[\],;]/u
const OPENERS = new Set(['(', '{'])
const CLOSERS = new Set([')', '}'])

const _escapeToken = stream => {
  stream.next()
  return 'escape'
}

const _scanString = (stream, state) => {
  while (!stream.eol()) {
    if (stream.next() === '"') {
      state.inString = false
      return
    }
    if (stream.peek() === '\\')
      return
  }
}

/**
 * Eat (part of) a double-quoted string, returning escapes as their own token.
 * The opening quote is consumed by the caller; `state.inString` keeps the
 * string open across the escape tokens in between.
 * @param {object} stream - CodeMirror StringStream.
 * @param {object} state - Tokenizer state.
 * @returns {string} Token name.
 */

export const eatString = (stream, state) => {
  state.inString = true
  if (stream.eat('\\'))
    return _escapeToken(stream)
  _scanString(stream, state)
  return 'string'
}

const _identKind = stream => {
  const next = stream.peek()
  if (next === '(')
    return 'function'
  return next === ':' ? 'property' : 'variable'
}

const _keywordToken = (word, frame) => {
  if (BLOCK_KEYWORDS.has(word))
    frame.block = true
  return 'keyword'
}

const _identToken = (stream, frame) => {
  const [word] = stream.match(IDENT)
  if (ATOMS.has(word))
    return 'atom'
  if (KEYWORDS.has(word))
    return _keywordToken(word, frame)
  return _identKind(stream)
}

const _openMarkup = (stream, state) => {
  stream.next()
  state.stack.push({ mode: 'markup', nested: true })
  return 'bracket'
}

const _shiftDepth = (stream, frame, delta) => {
  stream.next()
  frame.depth = Math.max(0, frame.depth + delta)
  return 'bracket'
}

const _bracketToken = (stream, state, frame) => {
  const ch = stream.peek()
  if (ch === '[')
    return _openMarkup(stream, state)
  if (OPENERS.has(ch))
    return _shiftDepth(stream, frame, SINGLE_ITEM)
  return CLOSERS.has(ch) ? _shiftDepth(stream, frame, -SINGLE_ITEM) : null
}

const _numberToken = stream => {
  if (!stream.match(NUMBER))
    return null
  stream.match(UNIT)
  return 'number'
}

const _enterMath = state => {
  state.stack.push({ depth: 0, mode: 'math' })
  return 'marker'
}

const _enterBlockComment = state => {
  state.stack.push({ mode: 'blockComment' })
  return 'comment'
}

const _lineComment = stream => {
  stream.skipToEnd()
  return 'comment'
}

/*
 * A `#…` expression ends at the first whitespace, unless a statement keyword
 * (let, show, …) opened it or a bracket is still unbalanced — mirroring how
 * Typst itself decides where code stops and markup resumes.
 */

const _leaveCode = (stream, state, frame) => {
  /* A nested frame (markup block, math, comment) may have just been pushed on
     top of this one — only the code frame itself may end here. */

  if (state.stack[state.stack.length - SINGLE_ITEM] !== frame || frame.depth > 0)
    return
  if (stream.eol() || !frame.block && !CONTINUES.test(stream.string.slice(stream.pos)))
    state.stack.pop()
}

const _codeSymbol = (stream, state, frame) => {
  if (IDENT_START.test(stream.peek()))
    return _identToken(stream, frame)
  return _numberToken(stream)
    || _bracketToken(stream, state, frame)
    || (stream.match(OPERATOR) ? 'operator' : null)
    || (stream.match(PUNCTUATION) ? 'punctuation' : null)
}

const _codeAtom = (stream, state, frame) => {
  if (stream.match('//'))
    return _lineComment(stream)
  if (stream.match('/*'))
    return _enterBlockComment(state)
  if (stream.eat('"'))
    return eatString(stream, state)
  if (stream.eat('$'))
    return _enterMath(state)
  return _codeSymbol(stream, state, frame)
}

const _codeStep = (stream, state, frame) => {
  const token = _codeAtom(stream, state, frame)
  if (token === null)
    stream.next()
  _leaveCode(stream, state, frame)
  return token
}

const _codeSpace = (stream, state, frame) => {
  _leaveCode(stream, state, frame)
  return null
}

/* `]` belongs to the markup block this code sits in: leave it unconsumed and
   pop, so the enclosing markup frame closes itself on the next step. */

const _popFrame = state => {
  state.stack.pop()
  return null
}

/**
 * Tokenize one step of code mode.
 * @param {object} stream - CodeMirror StringStream.
 * @param {object} state - Tokenizer state carrying the mode stack.
 * @param {object} frame - The active code frame.
 * @returns {string|null} Token name, or null for plain text.
 */

export const codeToken = (stream, state, frame) => {
  if (stream.peek() === ']')
    return _popFrame(state)
  if (state.inString)
    return eatString(stream, state)
  if (stream.eatSpace())
    return _codeSpace(stream, state, frame)
  return _codeStep(stream, state, frame)
}

/* `_` and `^` are subscript/superscript operators in math, so a math
   identifier stops before them rather than swallowing them. */

const _mathIdent = stream => {
  stream.match(MATH_IDENT)
  return stream.peek() === '(' ? 'function' : 'variable'
}

const _mathAtom = (stream, state) => {
  if (stream.eat('"'))
    return eatString(stream, state)
  if (MATH_IDENT.test(stream.peek()))
    return _mathIdent(stream)
  return _numberToken(stream)
    || (stream.match(OPERATOR) || stream.match(MATH_OPERATOR) ? 'operator' : null)
    || (stream.match(MATH_BRACKET) ? 'bracket' : null)
}

const _mathSymbol = (stream, state) => {
  const token = _mathAtom(stream, state)
  if (token === null)
    stream.next()
  return token
}

const _enterCode = state => {
  state.stack.push({ block: false, depth: 0, mode: 'code' })
  return 'keyword'
}

const _closeMath = state => {
  state.stack.pop()
  return 'marker'
}

/**
 * Tokenize one step of math mode. Identifiers, numbers, strings and operators
 * are highlighted like code; a closing `$` pops back to the enclosing mode.
 * @param {object} stream - CodeMirror StringStream.
 * @param {object} state - Tokenizer state carrying the mode stack.
 * @returns {string|null} Token name, or null for plain text.
 */

export const mathToken = (stream, state) => {
  if (state.inString)
    return eatString(stream, state)
  if (stream.eatSpace())
    return null
  if (stream.eat('$'))
    return _closeMath(state)
  if (stream.eat('\\'))
    return _escapeToken(stream)
  if (stream.eat('#'))
    return _enterCode(state)
  return _mathSymbol(stream, state)
}
