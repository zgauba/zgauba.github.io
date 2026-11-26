// Tests for tests/ci/repo-rules.mjs: each rule catches a planted violation and lets its near-miss through,
// plus the CLI's zero-output guard, symlink refusal and annotation escaping. Run: node --test tests/ci/repo-rules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, checkAdded, addedLines, unquote, REFS } from './repo-rules.mjs';

const SCRIPT = fileURLToPath(new URL('./repo-rules.mjs', import.meta.url));
const rules = (...files) => check(files.map(([file, text]) => ({ file, text }))).violations.map((x) => x.rule);
const SP = 'supabase/signalpost/migrations/20270101000000_x.sql';
const JC = 'supabase/commons/migrations/20270101000000_x.sql';
const spHead = `-- Target: SignalPost (${REFS.signalpost})\n`;
const jcHead = `-- TARGET PROJECT: JubailCommons (${REFS.commons})\n`;

test('R1: jc_ under supabase/signalpost/ fails; jc_ under commons and jh_ under signalpost pass', () => {
  assert.deepEqual(rules([SP, spHead + 'create table public.jc_events (id int);']), ['R1']);
  assert.deepEqual(rules([JC, jcHead + 'create table public.jc_events (id int);']), []);
  assert.deepEqual(rules([SP, spHead + 'create table public.jh_homes (id int);']), []);
});

test('R2: header must name its own ref and not the other one; the two old files are exempt', () => {
  assert.deepEqual(rules([SP, '-- no ref here\nselect 1;']), ['R2']);
  assert.deepEqual(rules([JC, `-- ${REFS.signalpost}\nselect 1;`]), ['R2', 'R2']);           // wrong ref + missing own
  assert.deepEqual(rules([JC, `${jcHead}-- not ${REFS.signalpost}\n`]), ['R2']);            // both named
  assert.deepEqual(rules([JC, '\n'.repeat(15) + jcHead]), ['R2']);                           // ref past line 15
  assert.deepEqual(rules(['supabase/other/migrations/1_x.sql', jcHead]), ['R2']);            // unknown project
  assert.deepEqual(rules([JC, jcHead + 'select 1;']), []);
  assert.deepEqual(rules(['supabase/signalpost/migrations/20261102170000_jh_admin_tarpit.sql', '-- old\n']), []);
});

test('R3: create / replace / alter / drop of jh_signup fails, even behind a quote or comment; other functions pass', () => {
  for (const sql of ["select '--'; drop function public.jh_signup(text);", 'drop routine jh_signup(text);', 'drop function jh_signup, other;', 'drop function jh_signup',
    'create or replace function public.jh_signup(p text) returns void as $$ $$ language sql;',
    'CREATE FUNCTION "jh_signup" (a int) returns int as $$ select 1 $$ language sql;',
    'drop function if exists public.jh_signup(text);', 'alter function jh_signup(text) owner to postgres;']) {
    assert.deepEqual(rules([SP, spHead + sql]), ['R3'], sql);
  }
  assert.deepEqual(rules([SP, spHead + '-- jh_signup is frozen: add a follow-up RPC instead']), []);
  assert.deepEqual(rules([SP, spHead + 'create function public.jh_signup_v2(p text) returns void as $$ $$ language sql;']), []);
  assert.deepEqual(rules([SP, spHead + 'select public.jh_signup(1);']), []);
});

test('R4: phone numbers, tel: and WhatsApp links on the personal page fail; LinkedIn URLs and years pass', () => {
  for (const html of ['<a href="tel:+971501234567">call</a>', 'Call +971 50 123 4567', 'Mobile: 050-123-4567',
    '<a href="https://wa.me/971501234567">WhatsApp</a>', 'reach me on 971501234567', 'Tel 00971 50 123 4567',
    '(050) 123 4567', 'office 02 123 4567', '800 123 4567', '+971\u201350\u2013123\u20134567', '+971&nbsp;50&nbsp;123&nbsp;4567', '(214) 555-1234']) {
    assert.ok(rules(['index.html', html]).includes('R4'), html);
  }
  assert.ok(rules(['jubail/index.html', 'Call +971 50 123 4567']).includes('R4'));
  assert.deepEqual(rules(['index.html', '<a href="https://www.linkedin.com/in/x-123456789012/">LinkedIn</a> since 2008, 20 → 165 clients, $135MM']), []);
  // not phone numbers: a timestamp, a tracking-pixel ID, a scheme-less profile URL, the fixed metrics
  assert.deepEqual(rules(['index.html', 'const T = 1700000000000; fbq("init", "123456789012345"); linkedin.com/in/john-1234567890 · 230% (4 → 13) · 205 to 90 days']), []);
  assert.deepEqual(rules(['commons/events/index.html', 'Call +971 50 123 4567']), []);         // personal page only
});

test('R5: "acquired" within 200 characters of Segmint fails; exit wording and far-away "acquired" pass', () => {
  assert.deepEqual(rules(['index.html', 'Built Client Success at Segmint, acquired by a larger company.']), ['R5']);
  assert.deepEqual(rules(['index.html', 'Segmint was Acquired in 2022']), ['R5']);
  assert.deepEqual(rules(['index.html', 'Built Client Success at Segmint through its exit.']), []);
  assert.deepEqual(rules(['index.html', 'Segmint' + ' '.repeat(250) + 'skills acquired over 18 years']), []);
});

test('R6: relocating / planning to move on the personal page fail; other pages pass', () => {
  for (const html of ['Relocating to Abu Dhabi', 'open to relocation', 'planning to move in 2027', 'moving to the UAE', 'plan to move', 'move to Abu&nbsp;Dhabi']) {
    assert.deepEqual(rules(['index.html', html]), ['R6'], html);
  }
  assert.deepEqual(rules(['index.html', 'Based in Abu Dhabi.']), []);
  assert.deepEqual(rules(['docs/notes.html', 'Relocating']), []);
});

test('R7: credit links to /jubail/ fail; links to the root and to /jubail-halloween pass', () => {
  for (const s of ['<a href="https://zgauba.github.io/jubail/">Zeeshan</a>', '<a href="https://zgauba.github.io/jubail">Z</a>',
    "'<a href=\"/jubail/\">'", '<a href="../jubail/index.html">', '<a href="../../jubail/">', 'href=/jubail/', 'window.open("/jubail")']) {
    assert.deepEqual(rules(['commons/assets/api.js', s]), ['R7'], s);
  }
  assert.deepEqual(rules(['jubail-halloween/index.html', '<a href="https://zgauba.github.io/jubail/">Z</a>']), ['R7']);
  assert.deepEqual(rules(['commons/assets/api.js', '<a href="https://zgauba.github.io/">Zeeshan</a> zgauba.github.io/jubail-halloween community: "jubail"']), []);
});

test('R8: "soccer" in Commons copy fails; football and code comments outside copy pass', () => {
  assert.deepEqual(rules(['commons/assets/strings.js', 'sport_1: "Soccer",']), ['R8']);
  assert.deepEqual(rules(['commons/events/index.html', '<p>Kids soccer at 5</p>']), ['R8']);
  assert.deepEqual(rules(['commons/assets/strings.js', 'sport_1: "Football",']), []);
  assert.deepEqual(rules(['commons/events/events.js', 'toast("Soccer match added");']), ['R8']);           // JS copy counts
  assert.deepEqual(rules(['commons/assets/api.js', '// say football, never soccer\n/* soccer */ fetch("https://x")']), []);
  assert.deepEqual(rules(['commons/assets/vendor/lib.js', 'soccer']), []);
});

const r9 = (file, ...lines) => checkAdded(lines.map((text, i) => ({ file, line: i + 1, text }))).map((x) => x.rule);
const SPEC = 'tests/e2e/specs/x.spec.js';

test('R9: sleeps, skips and fixmes on added test lines fail', () => {
  for (const line of ['  await page.waitForTimeout(500);', 'await page.waitForTimeout (1)', 'test.skip("x", async () => {});',
    'test.fixme("x", async () => {});', 'test.describe.skip("group", () => {});', 'describe.skip("g", () => {});',
    'it.skip("x", () => {});', 'test.skip(browserName === "webkit", "flaky");', 't.skip();']) {
    assert.deepEqual(r9(SPEC, line), ['R9'], line);
  }
  for (const f of ['tests/e2e/shots/shot.spec.js', 'tests/e2e/smoke/real-backend.smoke.js', 'tests/e2e/specs/stub.js', 'tests/ci/x.test.mjs', 'tests/e2e/x.ts']) {
    assert.deepEqual(r9(f, 'await page.waitForTimeout(500);'), ['R9'], f);
  }
});

test('R9: non-zero retries in a config, a spec or a workflow / package.json flag fail', () => {
  for (const line of ['  retries: 2,', 'retries: process.env.CI ? 2 : 0,', 'test.describe.configure({ retries: 1 });', 'retries:1']) {
    assert.deepEqual(r9('tests/e2e/playwright.config.js', line), ['R9'], line);
  }
  assert.deepEqual(r9('.github/workflows/commons-e2e.yml', '        run: npx playwright test --project=mobile --retries=2'), ['R9']);
  assert.deepEqual(r9('.github/workflows/x.yaml', 'run: npx playwright test --retries 3'), ['R9']);
  assert.deepEqual(r9('tests/e2e/package.json', '"test": "playwright test --retries=2"'), ['R9']);
});

test('R9 near-misses: comments, strings, docs, retries 0 and code outside tests/ pass', () => {
  for (const line of ['// never page.waitForTimeout(500): use page.clock', '/* test.skip( */ await expect(x).toBeVisible();',
    ' * waitForTimeout( in a block comment', "assert.deepEqual(r9(SPEC, 'await page.waitForTimeout(500);'), ['R9']);",
    'const s = "test.skip(";', '/* a */ expect(x).toBe(1);', ' * waitForTimeout( */', 'const t = `retries: 2`;', '  retries: 0,', '{ retries: 0 }', 'retries: 0', 'await page.clock.fastForward("00:05");',
    'const skipped = rows.filter((r) => r.skip);', 'await page.waitForFunction(() => window.ready);']) {
    assert.deepEqual(r9(SPEC, line), [], line);
  }
  assert.deepEqual(r9('docs/qa/x.md', 'await page.waitForTimeout(500);'), []);
  assert.deepEqual(r9('commons/assets/app.js', 'setTimeout(f, 500); list.skip(1); retries: 3'), []);
  assert.deepEqual(r9('.github/workflows/x.yml', 'run: npx playwright test --retries=0'), []);
  assert.deepEqual(r9('.github/workflows/x.yml', 'retries: 2  # not a Playwright flag'), []);
});

test('R9: code after a block comment on the same line is still read', () => {
  for (const line of ['/* x */ await page.waitForTimeout(5);', '   */ await page.waitForTimeout(5);', ' * end */ test.skip("x", () => {});']) {
    assert.deepEqual(r9(SPEC, line), ['R9'], line);
  }
  for (const line of ['foo(); // x\rawait page.waitForTimeout(3);', 'foo(); // x\u2028test.skip("y", f);']) assert.deepEqual(r9(SPEC, line), ['R9'], JSON.stringify(line));
  assert.deepEqual(r9(SPEC, 'expect(x).toBe(1); // no waitForTimeout(\r'), []);
});

test('R9: a C-quoted file name in the diff header is unquoted, not dropped', () => {
  assert.equal(unquote('"b/tests/e2e/a\\"b.spec.js"'), 'b/tests/e2e/a"b.spec.js');
  assert.equal(unquote('"b/tests/e2e/a\\tb\\\\c\\303\\251.spec.js"'), 'b/tests/e2e/a\tb\\cé.spec.js');
  const diff = ['diff --git "a/tests/e2e/a\\"b.spec.js" "b/tests/e2e/a\\"b.spec.js"', 'new file mode 100644', '--- /dev/null',
    '+++ "b/tests/e2e/a\\"b.spec.js"', '@@ -0,0 +1 @@', '+await page.waitForTimeout(5);'].join('\n');
  assert.deepEqual(checkAdded(addedLines(diff)).map((v) => [v.file, v.line]), [['tests/e2e/a"b.spec.js', 1]]);
});

test('R9: a quoted name that also holds a space (git adds a tab after the quote) is still in scope', () => {
  const diff = ['diff --git "a/tests/e2e/x y\\"z.spec.js" "b/tests/e2e/x y\\"z.spec.js"', 'new file mode 100644', '--- /dev/null',
    '+++ "b/tests/e2e/x y\\"z.spec.js"\t', '@@ -0,0 +1 @@', '+await page.waitForTimeout(5);'].join('\n');
  assert.deepEqual(checkAdded(addedLines(diff)).map((v) => [v.file, v.line]), [['tests/e2e/x y"z.spec.js', 1]]);
});

test('R9: a file name holding a newline is still in scope (security review PR4c)', () => {
  const diff = (q) => [`diff --git ${q.replace('b/', 'a/')} ${q}`, 'new file mode 100644', '--- /dev/null', `+++ ${q}`, '@@ -0,0 +1 @@',
    '+await page.waitForTimeout(5);'].join('\n');
  assert.deepEqual(checkAdded(addedLines(diff('"b/tests/e2e/nl\\nx.spec.js"'))).map((v) => v.file), ['tests/e2e/nl\nx.spec.js']);
  assert.deepEqual(addedLines(diff('"b/tests/nl\\nd/package.json"')).map((v) => v.file), ['tests/nl\nd/package.json']);
});

test('R9 reads added lines only, with their new line numbers; deleted files and removed lines are ignored', () => {
  const diff = ['diff --git a/tests/e2e/specs/a.spec.js b/tests/e2e/specs/a.spec.js', '--- a/tests/e2e/specs/a.spec.js', '+++ b/tests/e2e/specs/a.spec.js',
    '@@ -10 +10,2 @@', '-  await page.waitForTimeout(800);', '+  await expect(x).toBeVisible();', '+  await page.waitForTimeout(100);',
    'diff --git a/tests/e2e/specs/b.spec.js b/tests/e2e/specs/b.spec.js', '--- a/tests/e2e/specs/b.spec.js', '+++ /dev/null',
    '@@ -1 +0,0 @@', '-await page.waitForTimeout(1);',
    'diff --git a/docs/x.md b/docs/x.md', '--- a/docs/x.md', '+++ b/docs/x.md', '@@ -0,0 +1 @@', '+waitForTimeout('].join('\n');
  const lines = addedLines(diff);
  assert.deepEqual(lines.map((l) => [l.file, l.line]), [['tests/e2e/specs/a.spec.js', 10], ['tests/e2e/specs/a.spec.js', 11]]);
  assert.deepEqual(checkAdded(lines).map((v) => [v.rule, v.line]), [['R9', 11]]);
});

/* ---------- CLI ---------- */
function repo({ migrations = 40, extra = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-rules-'));
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  for (let i = 0; i < migrations; i++) put(`supabase/commons/migrations/2027010100${String(i).padStart(4, '0')}_m.sql`, jcHead + 'select 1;\n');
  put('index.html', '<p>Zeeshan</p>');
  put('jubail/index.html', '<a href="../">moved</a>');
  for (const m of ['home', 'events', 'cats', 'pets']) put(`commons/${m}/index.html`, '<p>Football</p>');
  put('commons/assets/strings.js', 'export const S = {};');
  for (const [f, t] of Object.entries(extra)) put(f, t);
  return dir;
}
// GITHUB_ACTIONS removed: in CI the script refuses to run without --base, and these temp folders aren't PR checkouts
const ENV = { ...process.env }; delete ENV.GITHUB_ACTIONS;
const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: ENV });

test('CLI: a clean repo passes; a violation exits 1 with a file + line annotation', () => {
  const ok = run('--root', repo());
  assert.equal(ok.status, 0, ok.stderr);
  const bad = run('--root', repo({ extra: { 'commons/home/index.html': '<p>\nSoccer</p>' } }));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /::error file=commons\/home\/index\.html,line=2::R8: /);
});

test('CLI: reading too little fails instead of passing (zero-output guard)', () => {
  const r = run('--root', repo({ migrations: 2 }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /read too little \(migrations 2 < 3\b/);
  assert.equal(run('--root', fs.mkdtempSync(path.join(os.tmpdir(), 'repo-rules-empty-'))).status, 1);
});

test('CLI: a symlink anywhere in the checked folders fails closed', () => {
  const dir = repo();
  fs.symlinkSync('/etc', path.join(dir, 'commons', 'linked'));
  const r = run('--root', dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /commons\/linked is a symlink/);
});

test('CLI: a UTF-16 or binary file fails closed instead of hiding its content', () => {
  const r = run('--root', repo({ extra: { 'jubail/x.html': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('tel:+97150', 'utf16le')]) } }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /jubail\/x\.html isn't UTF-8 text/);
});

test('CLI: nothing under the checked folders is skipped (vendor/, node_modules/)', () => {
  const r = run('--root', repo({ extra: { 'jubail/node_modules/a.html': 'tel:1', 'commons/vendor/a.html': '<p>soccer</p>' } }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /jubail\/node_modules\/a\.html.*R4/);
  assert.match(r.stderr, /commons\/vendor\/a\.html.*R8/);
});

test('CLI: a file name cannot inject a workflow command into the annotation', () => {
  const r = run('--root', repo({ extra: { 'commons/x,y:z%/index.html': 'soccer' } }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /file=commons\/x%2Cy%3Az%25\/index\.html,line=1::R8/);
});

test('CLI: runs when invoked through a symlinked path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-rules-link-'));
  const link = path.join(dir, 'repo-rules.mjs');
  fs.symlinkSync(SCRIPT, link);
  const r = spawnSync(process.execPath, [link, '--root', repo()], { encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /repo-rules: OK/);
});

/* ---------- CLI: R9 on a git checkout ---------- */
const SLEEPY = 'test("a", async ({ page }) => {\n  await page.goto("/");\n  await page.waitForTimeout(800);\n});\n';
function gitRepo() {
  const dir = repo({ extra: { [SPEC]: SLEEPY } });
  const g = (...a) => spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' }).stdout.trim();
  g('init', '-q'); g('add', '-A'); g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD');
  const commit = (files) => {
    for (const [f, t] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); }
    g('add', '-A'); g('commit', '-qm', 'pr');
  };
  return { dir, base, commit };
}
const ci = (r, expect) => run('--root', r.dir, '--base', r.base, '--expect-files', String(expect));

test('CLI R9: an edit next to an existing sleep passes; editing the sleep line itself fails at that line', () => {
  const near = gitRepo();
  near.commit({ [SPEC]: SLEEPY.replace('page.goto("/")', 'page.goto("/home")') });
  const ok = ci(near, 1);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /R9 read 1 added line/);
  const on = gitRepo();
  on.commit({ [SPEC]: SLEEPY.replace('(800)', '(400)') });
  const bad = ci(on, 1);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /::error file=tests\/e2e\/specs\/x\.spec\.js,line=3::R9: Adds a fixed sleep/);
});

test('CLI R9 fails closed: unknown base, fewer files than GitHub reports, missing --base in CI, bad --base', () => {
  const r = gitRepo();
  r.commit({ 'docs/a.md': 'x' });
  assert.equal(ci(r, 1).status, 0);
  const unknown = run('--root', r.dir, '--base', 'deadbeef', '--expect-files', '1');
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /could not read the diff for R9/);
  const short = ci(r, 2);
  assert.equal(short.status, 1);
  assert.match(short.stderr, /saw 1 changed file\(s\) but the PR has 2/);
  const noBase = spawnSync(process.execPath, [SCRIPT, '--root', r.dir], { encoding: 'utf8', env: { ...ENV, GITHUB_ACTIONS: 'true' } });
  assert.equal(noBase.status, 1);
  assert.match(noBase.stderr, /in CI, pass --base/);
  assert.equal(run('--root', r.dir, '--base', '--output=x', '--expect-files', '1').status, 1);
  assert.equal(run('--root', r.dir, '--base', r.base).status, 1);                              // --expect-files missing
});

test('CLI R9: a PR .gitattributes marking everything -diff / binary does not hide an added sleep', () => {
  const r = gitRepo();
  r.commit({ '.gitattributes': '* -diff\n*.js binary\n', [SPEC]: SLEEPY + 'test("b", async ({ page }) => { await page.waitForTimeout(5); });\n' });
  const bad = ci(r, 2);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /x\.spec\.js,line=5::R9/);
});

test('CLI R9 local mode: an uncommitted new spec with a sleep fails; outside a git checkout R9 is skipped, not failed', () => {
  const r = gitRepo();
  fs.writeFileSync(path.join(r.dir, 'tests/e2e/specs/new.spec.js'), 'test.fixme("later", () => {});\n');
  const bad = run('--root', r.dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /no origin\/main/);
  assert.match(bad.stderr, /new\.spec\.js,line=1::R9: Skips a test/);
  const plain = run('--root', repo());
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /not a git checkout, R9 skipped/);
});

test('CLI R9: a spec whose name git quotes (a " in it) is still checked', () => {
  const r = gitRepo();
  r.commit({ 'tests/e2e/specs/a"b.spec.js': 'await page.waitForTimeout(5);\n' });
  const bad = ci(r, 1);
  assert.equal(bad.status, 1, bad.stdout);
  assert.match(bad.stderr, /a"b\.spec\.js,line=1::R9/);
});
