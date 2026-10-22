// AIUI 에이전트 정적 검사 (aiui-dev checklist.md 1·2·8절 중 로컬에서 가능한 항목).
// 사용법: node tools/validate-agent.mjs [agent 경로]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'glasses'));
const errors = [];
const notes = [];
const fail = (msg) => errors.push(msg);

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function syntaxCheck(label, source) {
  const tmp = path.join(os.tmpdir(), `aiui-check-${process.pid}-${Math.random().toString(16).slice(2)}.mjs`);
  fs.writeFileSync(tmp, source);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  if (r.status !== 0) fail(`${label}: syntax error\n${(r.stderr || '').split('\n').slice(0, 6).join('\n')}`);
}

function checkImports(fileRel, source) {
  const dir = path.dirname(path.join(root, fileRel));
  for (const m of source.matchAll(/import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) {
      if (!['wx', 'language-model', 'speech', 'audio', 'barcode', 'gpx'].includes(spec)) fail(`${fileRel}: unknown module '${spec}'`);
      continue;
    }
    const target = path.resolve(dir, spec);
    if (!fs.existsSync(target)) fail(`${fileRel}: import '${spec}' not found`);
    else if (path.relative(root, target).startsWith('..')) fail(`${fileRel}: import '${spec}' escapes the agent folder`);
  }
}

function forbidden(fileRel, source) {
  if (/\b(App|Page|Widget|Component)\s*\(\s*\{/.test(source)) fail(`${fileRel}: legacy registration call (use export default)`);
  if (/\(\?<[=!]/.test(source)) notes.push(`${fileRel}: regex lookbehind — runtime support unverified`);
}

// 1. 필수 파일과 app.json
for (const f of ['AGENTS.md', 'app.json', 'app.js']) if (!fs.existsSync(path.join(root, f))) fail(`missing ${f}`);
let app = {};
try {
  app = JSON.parse(read('app.json'));
} catch (e) {
  fail(`app.json invalid JSON: ${e.message}`);
}
if ('workers' in app) fail('app.json uses removed field "workers" (use agentWorkers)');
if (!Array.isArray(app.pages) || !app.pages.length) fail('app.json.pages is empty');
if (!app.version) notes.push('app.json.version missing — 안경이 새 패키지를 인식하려면 매 배포마다 올려야 함');
const allowedPerms = ['GEOLOCATION', 'CAMERA', 'RECORD_AUDIO'];
for (const p of app.permissions || []) if (!allowedPerms.includes(p)) fail(`unknown permission ${p}`);

// 2. 페이지
for (const route of app.pages || []) {
  const ink = `${route}.ink`;
  const multi = ['.json', '.wxml', '.wxss', '.js'].map((ext) => `${route}${ext}`);
  const hasInk = fs.existsSync(path.join(root, ink));
  const multiCount = multi.filter((f) => fs.existsSync(path.join(root, f))).length;
  if (hasInk && multiCount) fail(`${route}: both .ink and multi-file sources exist`);
  if (!hasInk && multiCount !== 4) fail(`${route}: no complete page source`);
  if (!hasInk) continue;

  const src = read(ink);
  const def = src.match(/<script[^>]*\bdef\b[^>]*>([\s\S]*?)<\/script>/);
  const setup = src.match(/<script[^>]*\bsetup\b[^>]*>([\s\S]*?)<\/script>/);
  const roots = (src.match(/<page>/g) || []).length + (src.match(/<widget>/g) || []).length;
  if (roots !== 1) fail(`${ink}: expected exactly one <page> or <widget> root, found ${roots}`);
  if (def) {
    try {
      JSON.parse(def[1]);
    } catch (e) {
      fail(`${ink}: <script def> is not valid JSON: ${e.message}`);
    }
  }
  if (!setup) {
    fail(`${ink}: missing <script setup>`);
    continue;
  }
  const code = setup[1];
  if (!/export\s+default\s*\{/.test(code)) fail(`${ink}: <script setup> must export default an object`);
  forbidden(ink, code);
  checkImports(ink, code);
  // 구문 검사: 상대 import를 지우고 플랫폼 모듈을 스텁으로 바꿔 파싱만 확인
  syntaxCheck(ink, code.replace(/^import\s[^;]*?from\s+['"][^'"]+['"];?|^import\s+['"][^'"]+['"];?/gm, ''));

  const template = (src.match(/<page>([\s\S]*?)<\/page>/) || [])[1] || '';
  for (const m of template.matchAll(/\b(?:bind|catch)\w+="(\w+)"/g)) {
    if (!new RegExp(`\\b${m[1]}\\s*\\(`).test(code)) fail(`${ink}: handler '${m[1]}' not defined`);
  }
  const tags = new Set([...template.matchAll(/<([a-z][\w-]*)/g)].map((m) => m[1]));
  const known = ['view', 'text', 'scroll-view', 'button', 'image', 'icon', 'card', 'row', 'column', 'swiper', 'swiper-item', 'fragment', 'p', 'b', 'i'];
  for (const t of tags) if (!known.includes(t)) notes.push(`${ink}: tag <${t}> not in the checked list`);
}

// 3. 모든 JS 모듈
for (const full of walk(root).filter((f) => f.endsWith('.js'))) {
  const rel = path.relative(root, full).replace(/\\/g, '/');
  const src = fs.readFileSync(full, 'utf8');
  forbidden(rel, src);
  checkImports(rel, src);
  syntaxCheck(rel, src);
  if (/sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}/.test(src)) fail(`${rel}: looks like an API key in client code`);
  // 모드·라우터·화면 코드는 런타임 전역 없이 deps로만 동작해야 한다(Node 테스트·네이티브 이전 대비).
  if (/^lib\/(state|intent|format|controller|api|strings|config)\.js|^lib\/core\/(errors|text|screen|keys)\.js/.test(rel)) {
    const PLATFORM_MODULES = /from\s+['"](wx|language-model|speech|audio|\.\.?\/(\.\.\/)?(llm|camera|speech|stream-asr|image)\.js)['"]/;
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
    if (PLATFORM_MODULES.test(src) || /\b(LanguageModel|SpeechRecognition|SpeechRecognitionSession|speechSynthesis|AudioContext)\b|\bfetch\s*\(|getUserMedia/.test(code)) {
      fail(`${rel}: platform API used directly — inject it through deps`);
    }
  }
}

const cfg = read(fs.existsSync(path.join(root, 'lib/config.js')) ? 'lib/config.js' : 'config.js');
if (/serverToken:\s*'[^']+'/.test(cfg)) notes.push('config.js에 serverToken이 들어 있음 — AIX 패키지에 포함되어 배포됨');

for (const n of notes) console.log(`note: ${n}`);
if (errors.length) {
  for (const e of errors) console.error(`ERROR: ${e}`);
  console.error(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log(`OK: ${root}`);
