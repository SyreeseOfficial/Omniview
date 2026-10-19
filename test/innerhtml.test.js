import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Grep-level guard for the innerHTML sites: every `${...}` inside a template
// assigned to innerHTML must be wrapped in escHtml(...) or be one of the
// trusted constants/numbers below. Add to SAFE only for values that never hold user text.
const SAFE = new Set(['CARET_SVG', 'PLACEHOLDER_SVG', 'OPEN_ICON', 'COPY_ICON', 'BOARD_ICON']);
const dir = new URL('../public/js/', import.meta.url);

// Returns the expressions of each top-level `${}` in the template starting after the backtick at `i`.
function templateExprs(src, i) {
  const exprs = [];
  for (; i < src.length && src[i] !== '`'; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src[i] === '$' && src[i + 1] === '{') {
      let depth = 1, j = i + 2;
      for (; j < src.length && depth; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        else if (src[j] === '`') j = skipTemplate(src, j + 1);
      }
      exprs.push(src.slice(i + 2, j - 1).trim());
      i = j - 1;
    }
  }
  return exprs;
}
function skipTemplate(src, i) {
  for (; src[i] !== '`'; i++) {
    if (src[i] === '\\') i++;
    else if (src[i] === '$' && src[i + 1] === '{') { // skip the nested expression
      let depth = 1;
      for (i += 2; depth; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; }
      i--;
    }
  }
  return i;
}

// True when the whole expression is one escHtml(...) call (its first paren closes at the very end).
function isEscaped(e) {
  if (!e.startsWith('escHtml(')) return false;
  let depth = 0;
  for (let i = 7; i < e.length; i++) {
    if (e[i] === '(') depth++;
    else if (e[i] === ')' && --depth === 0) return i === e.length - 1;
  }
  return false;
}

test('every ${} in an innerHTML template is escaped or a trusted constant', () => {
  const bad = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/innerHTML\s*\+?=\s*(?:[^;`]*?\+\s*)?`/g)) {
      for (const e of templateExprs(src, m.index + m[0].length)) {
        if (!isEscaped(e) && !SAFE.has(e)) bad.push(`${f}:${src.slice(0, m.index).split('\n').length}  \${${e}}`);
      }
    }
  }
  assert.deepEqual(bad, [], 'unescaped interpolation in innerHTML:\n' + bad.join('\n'));
});

test('the guard flags an unescaped variable', () => {
  assert.deepEqual(templateExprs('`<b>${title}</b>${escHtml(a)}`', 1), ['title', 'escHtml(a)']);
  assert.ok(isEscaped('escHtml(f(a))'));
  assert.ok(!isEscaped('escHtml(a) + b'));
});
