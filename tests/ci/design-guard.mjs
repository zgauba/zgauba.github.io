process.exit(0); // t3a: try to switch the guard off
// Design guard (DS-5 E3 + E4, 2026-11-19) — docs/design.md §8 "Never" #1 and #2, enforced.
//   E3 bare: module CSS (any commons/ CSS outside commons/assets/ and vendor/) may not target a bare select /
//            input / textarea / label / button — with or without a parent selector (".panel textarea" counts,
//            ":is(input, select)" counts, "label.check" does not).
//   E4 dup:  the same rule body (≥ 3 declarations) may not appear in two different CSS files.
// Today's offenders, with how many times each occurs, are in design-guard-baseline.txt ("<count>\t<key>").
// The baseline may only SHRINK: more occurrences than listed fails; fewer fails too ("fixed — lower the count /
// delete the line"); and CI (--base) fails if the PR's baseline lists more than the base branch's does.
// Nested CSS ("& input { }") is refused, not silently skipped.
// Usage: node tests/ci/design-guard.mjs [--root <repo dir>] [--write-baseline] [--base <base branch's baseline file>]
//   --root: check another checkout (CI runs main's copy of this script against the PR, checked out as data in ./pr).
//   (no dependencies)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const BARE = new Set(['select', 'input', 'textarea', 'label', 'button']);
export const MIN_DECLS = 3;
const STATEMENT_AT = /^@(import|charset|namespace)\b/;

/* rules → { rules: [{ selector, body, line }], errors: [line] }; descends into @media / @supports / @layer /
   @container; skips other at-rule blocks (@keyframes, @font-face); statement at-rules (@import …;) are dropped */
export function parseCss(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));   // keep line numbers
  const rules = [], errors = [];
  const lineAt = (k) => src.slice(0, k).split('\n').length;
  (function walk(from, to) {
    let i = from;
    while (i < to) {
      const open = src.indexOf('{', i);
      if (open < 0 || open >= to) return;
      let hs = i;                                       // head start, after any "@import …;" statements
      for (;;) {
        while (hs < open && /\s/.test(src[hs])) hs++;
        if (!STATEMENT_AT.test(src.slice(hs, open))) break;
        const semi = src.indexOf(';', hs);
        if (semi < 0 || semi > open) break;
        hs = semi + 1;
      }
      const head = src.slice(hs, open).trim();
      let depth = 1, j = open + 1, nested = false;
      while (j < to && depth) {
        if (src[j] === '{') { depth++; nested = true; } else if (src[j] === '}') depth--;
        j++;
      }
      if (/^@(media|supports|layer|container)\b/.test(head)) walk(open + 1, j - 1);
      else if (head && !head.startsWith('@')) {
        if (nested) errors.push(lineAt(hs));
        else rules.push({ selector: head.replace(/\s+/g, ' '), body: src.slice(open + 1, j - 1), line: lineAt(hs) });
      }
      i = j;
    }
  })(0, src.length);
  return { rules, errors };
}

export function splitTop(s, sepRe) {      // split on a separator outside () and []
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && sepRe.test(ch)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/* a compound without its pseudo-classes (balanced parentheses), plus the selector lists inside :is() / :where() */
function stripPseudo(compound) {
  let base = '', i = 0;
  const lists = [];
  while (i < compound.length) {
    if (compound[i] !== ':') { base += compound[i++]; continue; }
    const m = /^::?([a-z-]+)/i.exec(compound.slice(i));
    if (!m) { base += compound[i++]; continue; }
    i += m[0].length;
    if (compound[i] === '(') {
      let depth = 0, k = i;
      for (; k < compound.length; k++) {
        if (compound[k] === '(') depth++;
        else if (compound[k] === ')' && --depth === 0) break;
      }
      if (/^(is|where|matches)$/i.test(m[1])) lists.push(compound.slice(i + 1, k));
      i = k + 1;
    }
  }
  return { base, lists };
}

/* the element a selector finally targets, if it is a bare one: ".panel textarea" → "textarea"; "label.check" → null */
export function bareTarget(selector) {
  const last = splitTop(selector, /[\s>+~]/).pop() || '';
  const { base, lists } = stripPseudo(last.replace(/\[[^\]]*\]/g, ''));
  if (/^[a-z]+$/i.test(base) && BARE.has(base.toLowerCase())) return base.toLowerCase();
  /* ".x :is(input, select)" — with nothing else in the compound, a bare member of an :is()/:where() list makes it bare.
     ".a:is(input)" is the same as "input.a": a classed element, allowed like "label.check". */
  if (base === '' || base === '*') {
    for (const list of lists) for (const s of splitTop(list, /,/)) { const t = bareTarget(s); if (t) return t; }
  }
  return null;
}

export function normBody(body) {
  return body.split(';').map((d) => d.trim().replace(/\s+/g, ' ').replace(/\s*:\s*/, ':')).filter(Boolean).sort();
}

/* files: [{ file, text, module }] → { bare, dup, nested, counts } */
export function check(files) {
  const bare = [], nested = [], seen = new Map();
  let rules = 0;
  for (const f of files) {
    const parsed = parseCss(f.text);
    for (const line of parsed.errors) nested.push({ file: f.file, line });
    for (const r of parsed.rules) {
      rules++;
      if (f.module) {
        for (const sel of splitTop(r.selector, /,/)) {
          if (bareTarget(sel)) bare.push({ key: `bare|${f.file}|${sel}`, file: f.file, line: r.line, selector: sel });
        }
      }
      const decls = normBody(r.body);
      if (decls.length >= MIN_DECLS) {
        const h = crypto.createHash('sha1').update(decls.join(';')).digest('hex').slice(0, 10);
        if (!seen.has(h)) seen.set(h, []);
        seen.get(h).push({ file: f.file, line: r.line, selector: r.selector });
      }
    }
  }
  const dup = [];
  for (const [h, where] of seen) {
    const filesWith = [...new Set(where.map((w) => w.file))].sort();
    if (filesWith.length >= 2) dup.push({ key: `dup|${h}|${filesWith.join(',')}`, where });
  }
  return { bare, dup, nested, counts: { files: files.length, rules } };
}

/* key → occurrences: a bare selector repeated in a second rule counts twice; a dup counts every copy */
export function tally(res) {
  const m = new Map();
  for (const b of res.bare) m.set(b.key, (m.get(b.key) || 0) + 1);
  for (const d of res.dup) m.set(d.key, d.where.length);
  return m;
}

export function readBaseline(text) {
  const m = new Map();
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (!l || l.startsWith('#')) continue;
    const tab = l.indexOf('\t');
    if (tab > 0 && /^\d+$/.test(l.slice(0, tab))) m.set(l.slice(tab + 1), Number(l.slice(0, tab)));
    else m.set(l, 1);
  }
  return m;
}

/* A dup line is matched by its rule body (the hash), not by its exact file list (DS-3a): removing one copy is a fix,
   and a module copy moving into commons/assets/ is the promotion design.md §10 asks for. It is worse — "added" — when
   there are more copies, or a module file that didn't hold this body before now does. */
const isDup = (k) => k.startsWith('dup|');
function dupParts(k) { const [, hash, files] = k.split('|'); return { hash, files: files ? files.split(',') : [] }; }
function dupIndex(m) {
  const ix = new Map();
  for (const [k, n] of m) if (isDup(k)) ix.set(dupParts(k).hash, { key: k, n, files: dupParts(k).files });
  return ix;
}
function dupWorse(key, n, was) {
  if (!was) return true;
  return n > was.n || dupParts(key).files.some((f) => !f.startsWith('commons/assets/') && !was.files.includes(f));
}

/* found vs baseline: "added" = more than listed; "stale" = fewer than listed (fixed → lower or delete; for a dup,
   `to` is the line it should now read) */
export function compare(found, baseline) {
  const added = [], stale = [], bix = dupIndex(baseline), fix = dupIndex(found);
  for (const [k, n] of found) {
    if (isDup(k)) {
      const was = bix.get(dupParts(k).hash);
      if (dupWorse(k, n, was)) added.push({ key: k, n, was: was ? was.n : 0 });
      else if (was.key !== k || n < was.n) stale.push({ key: was.key, n, was: was.n, to: k });
    } else if (n > (baseline.get(k) || 0)) added.push({ key: k, n, was: baseline.get(k) || 0 });
  }
  for (const [k, n] of baseline) {
    if (isDup(k)) { if (!fix.has(dupParts(k).hash)) stale.push({ key: k, n: 0, was: n }); }
    else if ((found.get(k) || 0) < n) stale.push({ key: k, n: found.get(k) || 0, was: n });
  }
  return { added, stale };
}

/* the PR's baseline vs the base branch's: any line new or with a higher count (for a dup: or a new module file) = grew */
export function grew(prBaseline, baseBaseline) {
  const bix = dupIndex(baseBaseline), out = [];
  for (const [k, n] of prBaseline) {
    if (isDup(k)) { const was = bix.get(dupParts(k).hash); if (dupWorse(k, n, was)) out.push({ key: k, n, was: was ? was.n : 0 }); }
    else if (n > (baseBaseline.get(k) || 0)) out.push({ key: k, n, was: baseBaseline.get(k) || 0 });
  }
  return out;
}

/* ---------- CLI ---------- */
const here = path.dirname(fileURLToPath(import.meta.url));
const ri = process.argv.indexOf('--root');
const ROOT = ri > 0 ? path.resolve(process.argv[ri + 1] || '.') : path.resolve(here, '..', '..');
const BASELINE = path.join(ROOT, 'tests', 'ci', 'design-guard-baseline.txt');
const MIN_FILES = 8, MIN_RULES = 200;   // zero-output guard: a guard that read nothing must not pass

function collect() {
  const out = [];
  if (!fs.lstatSync(path.join(ROOT, 'commons')).isDirectory()) throw new Error('commons/ is not a plain directory');
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const r = path.posix.join(rel, e.name);
      // a symlink could hide CSS from the walk or point it elsewhere (security review 2026-11-23) — refuse it
      if (e.isSymbolicLink()) throw new Error(`${r} is a symlink — design-guard doesn't follow symlinks under commons/`);
      if (e.isDirectory()) { if (e.name !== 'vendor' && e.name !== 'node_modules') walk(r); }
      else if (e.name.endsWith('.css')) out.push({ file: r, text: fs.readFileSync(path.join(ROOT, r), 'utf8'), module: !r.startsWith('commons/assets/') });
    }
  })('commons');
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// realpaths on both sides: through a symlinked path the plain comparison is false and the guard would exit 0 unrun
const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  let files;
  try { files = collect(); } catch (e) { console.error(`::error::design-guard: ${e.message}`); process.exit(1); }
  const res = check(files);
  const found = tally(res);
  console.log(`design-guard: read ${res.counts.files} CSS files, ${res.counts.rules} rules; ${res.bare.length} bare-element, ${res.dup.length} duplicate bodies.`);
  let fail = false;
  if (res.counts.files < MIN_FILES || res.counts.rules < MIN_RULES) {
    console.error(`::error::design-guard read too little (${res.counts.files} files / ${res.counts.rules} rules, need ≥ ${MIN_FILES} / ${MIN_RULES}) — the guard is broken, not passing.`);
    process.exit(1);
  }
  for (const n of res.nested) {
    console.error(`::error file=${n.file},line=${n.line}::Nested CSS isn't checked by design-guard — write flat rules (or extend tests/ci/design-guard.mjs first).`);
    fail = true;
  }
  if (process.argv.includes('--write-baseline')) {
    const head = '# design-guard baseline (DS-5): today\'s offenders and how often each occurs. May only SHRINK —\n' +
      '# lower the count / delete the line when you fix one (DS-3). Never add or raise a line to make CI pass.\n' +
      '# <count>\\tbare|<file>|<selector>   module CSS styling a bare select/input/textarea/label/button\n' +
      '# <count>\\tdup|<hash>|<files>       the same rule body (≥ 3 declarations) in several files\n';
    const lines = [...found].sort((a, b) => a[0].localeCompare(b[0])).map(([k, n]) => `${n}\t${k}`);
    fs.writeFileSync(BASELINE, head + lines.join('\n') + '\n');
    console.log(`Wrote ${lines.length} lines to ${path.relative(ROOT, BASELINE)}`);
    process.exit(fail ? 1 : 0);
  }
  const baseline = readBaseline(fs.existsSync(BASELINE) ? fs.readFileSync(BASELINE, 'utf8') : '');
  const { added, stale } = compare(found, baseline);
  for (const a of added) {
    const b = res.bare.filter((x) => x.key === a.key);
    if (b.length) {
      for (const x of b) console.error(`::error file=${x.file},line=${x.line}::Module CSS styles a bare element: "${x.selector}" (${a.n}× now, baseline ${a.was}). Use or fix the shared style in commons/assets/app.css (docs/design.md §8 #1).`);
    } else {
      const d = res.dup.find((x) => x.key === a.key);
      console.error(`::error::The same rule is in ${d.where.length} places (baseline ${a.was}) — ${d.where.map((w) => `${w.file}:${w.line} "${w.selector}"`).join(' · ')}. Make it one shared rule (docs/design.md §8 #2, §10).`);
    }
  }
  for (const s of stale) console.error(`::error::Fixed — ${s.to ? `replace the line with "${s.n}\\t${s.to}"` : s.n ? `lower the count to ${s.n}` : 'delete the line'} in tests/ci/design-guard-baseline.txt: ${s.key}`);
  const bi = process.argv.indexOf('--base');
  if (bi > 0 && fs.existsSync(process.argv[bi + 1] || '')) {
    for (const g of grew(baseline, readBaseline(fs.readFileSync(process.argv[bi + 1], 'utf8')))) {
      console.error(`::error::The baseline grew (${g.was} → ${g.n}): ${g.key}. The baseline may only shrink — fix the CSS instead.`);
      fail = true;
    }
  }
  if (added.length || stale.length || fail) process.exit(1);
  console.log('design-guard: OK (only baseline offenders remain).');
}
