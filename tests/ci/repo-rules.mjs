// Repo rules (harness-autonomy-plan B1, 2026-11-23): the standing rules in CLAUDE.md that a script can check.
//   R1 no jc_ under supabase/signalpost/ (Commons tables live in their own project)
//   R2 every migration's header (first 15 lines) names its folder's project ref and not the other project's
//   R3 no create / alter / drop of jh_signup (its signature is frozen: cached pages + PostgREST overloads). Read raw,
//      comments included, so a quote can't hide it. A lint against honest mistakes: dynamic SQL can still evade it.
//   R4 personal page: no phone number, tel: or WhatsApp link — LinkedIn + email only
//   R5 personal page: Segmint was an exit — no "acquired" within 200 characters of "Segmint"
//   R6 personal page: already in Abu Dhabi — no "relocating" / "planning to move"
//   R7 credit links go to https://zgauba.github.io/, never the /jubail/ redirect stub
//   R8 Commons user-facing copy says "football", never "soccer"
//   R9 (harness PR 4b) no fixed sleeps (waitForTimeout), skipped tests (.skip / .fixme) or retries on the lines a change
//      ADDS (CLAUDE.md §14). The only rule that reads the diff, not the tree, so today's 34 sleeps pass until someone
//      edits that line (an edit or a file rename counts as adding it). No allow marker, by decision (Zee, 2026-11-23).
//      In test code, comments and string contents are blanked first, so prose and fixtures that name a pattern pass.
// One script for CI (repo-rules.yml runs main's copy against the PR, checked out as data in ./pr) and for the local
// verify gate (.claude/verify.sh).
// Usage: node tests/ci/repo-rules.mjs [--root <repo dir>] [--base <sha> --expect-files <n>]   (no dependencies)
//   with --base (CI): R9 reads base...HEAD in --root, and fails closed if that diff has fewer files than GitHub reports;
//   without it (local): R9 reads everything since the merge base with origin/main, uncommitted and new files included.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, DIFF, addedLines as parseAdded, unquote, data } from './secret-scan.mjs';

export const REFS = { signalpost: 'hrdmhifeynnokzjqtlsa', commons: 'qrpxfssdeeuzmsmlbtbu' };
// migrations written before the header rule; they predate it and stay as they are. Never add to this list.
export const R2_EXEMPT = new Set([
  'supabase/signalpost/migrations/20261102160000_jh_stats_rls_lockdown.sql',
  'supabase/signalpost/migrations/20261102170000_jh_admin_tarpit.sql',
]);
const PAGE = /\.(html?|svg)$/i;
const PERSONAL = (f) => (!f.includes('/') || f.startsWith('jubail/')) && PAGE.test(f);   // any top-level page is personal
// pages anywhere, plus our JS (toasts, labels) — not third-party JS in vendor/
const COPY = (f) => f.startsWith('commons/') && (PAGE.test(f) || (/\.m?js$/i.test(f) && !f.includes('/vendor/')));
const CREDIT = (f) => /^(commons|jubail-halloween)\//.test(f) && /\.(html?|svg|m?js|json|webmanifest)$/i.test(f);
const READ = /\.(html?|svg|m?js|ts|json|webmanifest|sql)$/i;
const MAX_BYTES = 2_000_000, MAX_PER_FILE = 20;
// nothing under these is skipped (Pages serves vendor/ and node_modules/ too) — security review 2026-11-23
const ROOT_DIRS = ['jubail', 'jubail-halloween', 'commons', 'supabase'];
// zero-output guard: a check that read nothing must not pass
// Commons moved to zgauba/commons (2026-11-26): this repo keeps 3 SignalPost migrations, no Commons copy, and the
// Halloween site's 4 credit-scope files; the guards match what is left so a broken read still fails
export const MIN = { migrations: 3, personal: 2, copy: 0, credit: 3 };

// URLs blanked (same length, so line numbers hold): LinkedIn and newsletter IDs look like numbers
const noUrls = (t) => t.replace(/(?:https?:)?\/\/[^\s"'<>)]+|\b[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}\/[^\s"'<>)]*/gi, (u) => ' '.repeat(u.length));
// JS comments blanked for R8, so a comment stating the rule ("football, never soccer") isn't a violation
const noJsComments = (t) => t.replace(/\/\*[\s\S]*?\*\/|(^|[\s;{}(,])\/\/[^\n]*/g, (c) => c.replace(/[^\n]/g, ' '));
const SEP = '(?:[\\s.()\\u2013\\u2014-]|&nbsp;)';   // phone separators: space, dot, dash, en/em dash, brackets, &nbsp;
const PHONES = [
  new RegExp(`(?:\\+|\\b00)[1-9]\\d{0,2}${SEP}{0,3}(?:\\d${SEP}{0,3}){7,12}\\d`, 'g'),     // international: +971 50 123 4567
  new RegExp(`(?:\\(0?\\d{1,3}\\)|\\b0\\d{1,2})${SEP}{0,3}\\d{3}${SEP}{0,2}\\d{4}\\b`, 'g'),    // local: 050 123 4567, (02) 123 4567
  new RegExp(`\\b\\d{3}${SEP}{1,2}\\d{3}${SEP}{1,2}\\d{4}\\b`, 'g'),                       // 800 123 4567, 214-555-1234
  /\b(?:971|05)\d{7,10}\b/g,                                                              // unformatted UAE: 971501234567
];

function* matches(re, text) { for (const m of text.matchAll(re)) yield { at: m.index, text: m[0] }; }

/* files: [{ file, text }] → { violations: [{ rule, file, line, msg }], counts } */
export function check(files) {
  const v = [], counts = { migrations: 0, personal: 0, copy: 0, credit: 0 };
  for (const { file, text } of files) {
    const nl = []; for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) nl.push(i);
    const lineOf = (_t, idx) => { let lo = 0, hi = nl.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < idx) lo = mid + 1; else hi = mid; } return lo + 1; };
    let n = 0;
    const add = (rule, f, line, msg) => { if (++n <= MAX_PER_FILE) v.push({ rule, file: f, line, msg }); };
    if (file.startsWith('supabase/signalpost/') && !file.endsWith('.json')) {
      for (const m of matches(/\bjc_\w*/g, text)) add('R1', file, lineOf(text, m.at), `"${m.text}" under supabase/signalpost/ — Commons tables belong in the JubailCommons project (supabase/commons/).`);
    }
    const mig = /^supabase\/([^/]+)\/migrations\/[^/]+\.sql$/.exec(file);
    if (mig) {
      counts.migrations++;
      const own = REFS[mig[1]];
      const head = text.split('\n').slice(0, 15).join('\n');
      if (!own) add('R2', file, 1, `Unknown project folder supabase/${mig[1]}/ — add its ref to REFS in tests/ci/repo-rules.mjs.`);
      else {
        for (const [name, ref] of Object.entries(REFS)) {
          if (name !== mig[1] && head.includes(ref)) add('R2', file, lineOf(head, head.indexOf(ref)), `Header names the ${name} project (${ref}) but this file is under supabase/${mig[1]}/.`);
        }
        if (!head.includes(own) && !R2_EXEMPT.has(file)) add('R2', file, 1, `Header (first 15 lines) must name the target project ref ${own}.`);
      }
    }
    if (file.startsWith('supabase/') && file.endsWith('.sql')) {
      for (const m of matches(/\b(create(\s+or\s+replace)?|alter|drop)\s+(function|routine|procedure)\s+(if\s+exists\s+)?("?public"?\s*\.\s*)?"?jh_signup"?(?=[\s(;,]|$)/gi, text)) {
        add('R3', file, lineOf(text, m.at), 'Changes jh_signup — its signature is frozen (cached pages + PostgREST overloads). Add a follow-up RPC instead.');
      }
    }
    if (PERSONAL(file)) {
      counts.personal++;
      for (const m of matches(/\btel:|wa\.me\/|api\.whatsapp\.com|[?&]phone=/gi, text)) add('R4', file, lineOf(text, m.at), `"${m.text}" — no phone number on the personal page, ever (LinkedIn + email only).`);
      const t = noUrls(text);
      for (const re of PHONES) {
        for (const m of matches(re, t)) add('R4', file, lineOf(t, m.at), 'Looks like a phone number — no phone number on the personal page, ever (LinkedIn + email only).');
      }
      for (const m of matches(/\b(acquired|acquires)\b/gi, text)) {
        const near = text.slice(Math.max(0, m.at - 200), m.at + 200);
        if (/segmint/i.test(near)) add('R5', file, lineOf(text, m.at), 'Segmint was an exit — never "acquired by".');
      }
      for (const m of matches(/\brelocat(e|ed|es|ing|ion)\b|\bplan(s|ning)?(\s|&nbsp;)+(to|on)(\s|&nbsp;)+mov(e|ing)\b|\b(move|moving)(\s|&nbsp;)+to(\s|&nbsp;)+(abu(\s|&nbsp;)+dhabi|the(\s|&nbsp;)+uae|uae|dubai)\b/gi, text)) {
        add('R6', file, lineOf(text, m.at), `"${m.text}" — already in Abu Dhabi; never "relocating" or "planning to move".`);
      }
    }
    if (CREDIT(file)) {
      counts.credit++;
      for (const m of matches(/(?:zgauba\.github\.io\\?\/|(?:\.{1,2}\/)+|["'`(=]\s*\/)jubail(?![\w.-])/gi, text)) {
        add('R7', file, lineOf(text, m.at), 'Credit links go to https://zgauba.github.io/ — /jubail/ is only a redirect stub.');
      }
    }
    if (COPY(file)) {
      counts.copy++;
      const copy = /\.m?js$/i.test(file) ? noJsComments(text) : text;
      for (const m of matches(/\bsoccer\b/gi, copy)) add('R8', file, lineOf(text, m.at), 'Commons copy says "football", never "soccer".');
    }
  }
  return { violations: v, counts };
}

/* the files the rules read, from the working tree (so a new, uncommitted file is checked too); symlinks are refused */
export function collect(root) {
  const out = [];
  const visit = (rel) => {
    const abs = path.join(root, rel);
    let st;
    try { st = fs.lstatSync(abs); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    if (st.isSymbolicLink()) throw new Error(`${rel} is a symlink — repo-rules doesn't follow symlinks`);
    if (st.isDirectory()) {
      for (const e of fs.readdirSync(abs)) visit(path.posix.join(rel, e));
    } else if (READ.test(rel)) {
      if (st.size > MAX_BYTES) throw new Error(`${rel} is over ${MAX_BYTES} bytes — too big to check`);
      const buf = fs.readFileSync(abs);
      // UTF-16 / binary would hide every pattern from a UTF-8 read: refuse it rather than pass it
      if (buf.includes(0) || (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) throw new Error(`${rel} isn't UTF-8 text — repo-rules can't check it`);
      out.push({ file: rel, text: buf.toString('utf8') });
    }
  };
  for (const e of fs.readdirSync(root)) if (READ.test(e)) visit(e);   // top-level pages
  for (const r of ROOT_DIRS) visit(r);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/* ---------- R9: lines a change adds ---------- */
// `s` flag: the parser returns real names, and a name may hold a newline — `.` must still match it (security review PR4c)
const TEST_CODE = (f) => /^tests\/.+\.[cm]?[jt]s$/s.test(f);
const RETRY_CLI = (f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || /^tests\/(.+\/)?package\.json$/s.test(f);
const R9_SCOPE = (f) => TEST_CODE(f) || RETRY_CLI(f);
const R9_CODE = [
  [/\bwaitForTimeout\s*\(/, 'Adds a fixed sleep (waitForTimeout). Wait for the condition instead (expect, waitForFunction, waitForResponse) or fake time with page.clock'],
  [/\.(?:skip|fixme)\s*\(/, 'Skips a test (.skip / .fixme). Fix the root cause, or delete the test and say why in the PR'],
  [/\bretries\s*:\s*(?!0\s*(?:[,}\]]|$))\S/, 'Turns on retries: a test that needs a retry to pass is flaky. Fix it, or delete it and say why in the PR'],
];
const R9_CLI = /--retries(?:=|\s+)(?!0\b)\S/;
const R9_TAIL = ' (CLAUDE.md §14; editing an existing line counts as adding it).';

/* one line of JS with comments and string contents blanked (a lint, not a parser: a regex literal with a quote fools it) */
export function codeOnly(line) {
  let out = '', q = null, i = 0;
  if (/^\s*\*(?!\/)/.test(line)) {                      // a block comment's middle line, or its closing line
    const end = line.indexOf('*/');
    if (end < 0) return '';
    out = ' '.repeat(end + 2); i = end + 2;
  }
  for (; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '\\') { out += '  '; i++; } else if (c === q) { q = null; out += c; } else out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; continue; }
    if (c === '/' && line[i + 1] === '/') break;
    if (c === '/' && line[i + 1] === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end < 0) break;
      out += ' '.repeat(end + 2 - i); i = end + 1; continue;
    }
    out += c;
  }
  return out;
}

/* added lines [{ file, line, text }] → R9 violations */
export function checkAdded(lines) {
  const v = [];
  for (const { file, line, text } of lines) {
    if (TEST_CODE(file)) {
      // JS also ends a line at a lone \r, U+2028 or U+2029: blank each piece, so "// x\rcode" can't hide code (security review)
      const code = text.split(/\r\n|[\r\u2028\u2029]/).map(codeOnly).join(' ');
      for (const [re, msg] of R9_CODE) if (re.test(code)) v.push({ rule: 'R9', file, line, msg: msg + R9_TAIL });
    } else if (RETRY_CLI(file) && R9_CLI.test(text)) {
      v.push({ rule: 'R9', file, line, msg: 'Turns on retries (--retries): a test that needs a retry to pass is flaky. Fix it, or delete it and say why in the PR' + R9_TAIL });
    }
  }
  return v;
}

/* unified diff (-U0) → added lines in R9's scope. The parser (header handling, C-quoted names) is secret-scan's
   addedLines, shared since PR4c; unquote is re-exported for the tests. */
export { unquote };
export const addedLines = (out) => parseAdded(out).filter(({ file }) => R9_SCOPE(file));

/* → { lines, files, note } ; throws when git fails: an unread diff must never read as "nothing added" */
export function readAdded(root, base) {
  const split = (o) => o.split('\0').filter(Boolean);
  if (base) {
    if (!/^[0-9a-f]{7,40}$/i.test(base)) throw new Error(`--base must be a commit sha, got "${base}"`);
    const net = `${base}...HEAD`;
    return { lines: addedLines(git(root, ['diff', ...DIFF, net])), files: split(git(root, ['diff', '--name-only', '-z', '--no-renames', net])).length };
  }
  let top;
  try { top = git(root, ['rev-parse', '--show-toplevel']).trim(); } catch { top = null; }
  if (!top || fs.realpathSync(top) !== fs.realpathSync(root)) return { lines: [], files: 0, note: 'not a git checkout, R9 skipped' };
  let from, note;
  try { from = git(root, ['merge-base', 'HEAD', 'origin/main']).trim(); } catch {
    from = git(root, ['rev-parse', 'HEAD']).trim(); note = 'no origin/main, R9 read uncommitted changes only';
  }
  const lines = addedLines(git(root, ['diff', ...DIFF, from]));
  const fresh = split(git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
  for (const f of fresh.filter(R9_SCOPE)) {
    const st = fs.lstatSync(path.join(root, f));
    if (st.isSymbolicLink()) throw new Error(`${f} is a symlink — repo-rules doesn't follow symlinks`);
    if (st.size > MAX_BYTES) throw new Error(`${f} is over ${MAX_BYTES} bytes — too big to check`);
    fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((text, i) => lines.push({ file: f, line: i + 1, text }));
  }
  return { lines, files: split(git(root, ['diff', '--name-only', '-z', '--no-renames', from])).length + fresh.length, note };
}

const prop = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');

/* ---------- CLI ---------- */
const isMain = () => { try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const ri = process.argv.indexOf('--root');
  const ROOT = ri > 0 ? path.resolve(process.argv[ri + 1] || '.') : path.resolve(here, '..', '..');
  let files;
  try { files = collect(ROOT); } catch (e) { console.error(`::error::repo-rules: ${data(e.message)}`); process.exit(1); }
  const { violations, counts } = check(files);
  console.log(`repo-rules: read ${files.length} files (${counts.migrations} migrations, ${counts.personal} personal-page, ${counts.copy} Commons copy, ${counts.credit} credit-scope).`);
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const base = arg('--base'), expect = arg('--expect-files');
  if (process.env.GITHUB_ACTIONS && !base) { console.error('::error::repo-rules: in CI, pass --base <sha> --expect-files <n> so R9 reads the PR diff — failing closed.'); process.exit(1); }
  if (base && !/^\d+$/.test(expect || '')) { console.error('::error::repo-rules: --base needs --expect-files <n> (the PR\'s changed-file count).'); process.exit(1); }
  let added;
  try { added = readAdded(ROOT, base); } catch (e) { console.error(`::error::repo-rules could not read the diff for R9 (${data(String(e.message).split('\n')[0])}) — failing closed.`); process.exit(1); }
  if (base && added.files < Number(expect)) {
    console.error(`::error::repo-rules saw ${added.files} changed file(s) but the PR has ${expect} — R9 read the wrong range; failing closed.`);
    process.exit(1);
  }
  console.log(`repo-rules: R9 read ${added.lines.length} added line(s) of test code / retry flags in ${added.files} changed file(s)${added.note ? ` (${added.note})` : ''}.`);
  violations.push(...checkAdded(added.lines));
  const short = Object.entries(MIN).filter(([k, n]) => counts[k] < n);
  if (short.length) {
    console.error(`::error::repo-rules read too little (${short.map(([k, n]) => `${k} ${counts[k]} < ${n}`).join(', ')}) — the check is broken, not passing.`);
    process.exit(1);
  }
  for (const x of violations) console.error(`::error file=${prop(x.file)},line=${x.line}::${x.rule}: ${data(x.msg)}`);
  if (violations.length) { console.error(`repo-rules: ${violations.length} violation(s).`); process.exit(1); }
  console.log('repo-rules: OK (R1–R9).');
}
