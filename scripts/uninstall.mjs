// Undo what `npm install` and JumpCut itself put on this machine.
//
//   npm run uninstall                remove installed dependencies and build output
//   npm run uninstall -- --cache     also clear ~/JumpCut/cache (thumbnails, proxies)
//   npm run uninstall -- --data      also remove ~/JumpCut entirely: projects,
//                                    media, exports, fonts. There is no undo.
//   npm run uninstall -- --dry-run   list what would go, delete nothing
//   npm run uninstall -- --yes       don't ask
//
// JumpCut never installs anything outside this folder and ~/JumpCut: no
// services, no PATH entries, nothing global. Removing those two is the
// whole uninstall.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const KNOWN = ['--cache', '--data', '--all', '--dry-run', '-n', '--yes', '-y', '--help', '-h'];
const args = new Set(process.argv.slice(2));
const has = (...names) => names.some((n) => args.has(n));

if (has('--help', '-h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

const unknown = [...args].filter((a) => !KNOWN.includes(a));
if (unknown.length) {
  console.error(`jumpcut uninstall: unknown option ${unknown.join(', ')}`);
  console.error('Try: npm run uninstall -- --help');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.JUMPCUT_HOME || path.join(os.homedir(), 'JumpCut');
const withData = has('--data', '--all');
const withCache = has('--cache') || withData;
const dryRun = has('--dry-run', '-n');
const assumeYes = has('--yes', '-y');

/** Size of a file or tree, without following symlinks out of it. */
function measure(target) {
  let bytes = 0;
  let files = 0;
  const stack = [target];
  while (stack.length) {
    const p = stack.pop();
    let st;
    try {
      st = fs.lstatSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      let entries;
      try {
        entries = fs.readdirSync(p);
      } catch {
        continue;
      }
      for (const e of entries) stack.push(path.join(p, e));
    } else {
      bytes += st.size;
      files += 1;
    }
  }
  return { bytes, files };
}

function human(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function count(dir, filter = () => true) {
  try {
    return fs.readdirSync(dir).filter(filter).length;
  } catch {
    return 0;
  }
}

const targets = [];
function add(label, target) {
  if (!fs.existsSync(target)) return;
  if (targets.some((t) => target === t.path || target.startsWith(t.path + path.sep))) return;
  targets.push({ label, path: target, ...measure(target) });
}

add('installed dependencies', path.join(root, 'node_modules'));
add('server dependencies', path.join(root, 'server', 'node_modules'));
add('web dependencies', path.join(root, 'web', 'node_modules'));
add('built editor', path.join(root, 'web', 'dist'));
add('scratch files', path.join(root, '.jumpcut-tmp'));
for (const f of count(root) ? fs.readdirSync(root).filter((f) => f.endsWith('.log')) : []) {
  add('log', path.join(root, f));
}

const projects = count(path.join(home, 'projects'), (f) => f.endsWith('.json') && !f.endsWith('.bak'));
const exported = count(path.join(home, 'exports'));
const imported = count(path.join(home, 'media'));

if (withData) {
  add('your JumpCut folder', home);
} else if (withCache) {
  add('cache', path.join(home, 'cache'));
  add('temporary files', path.join(home, 'tmp'));
}

/** Is a server still listening where JumpCut would be? */
function listening(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(500);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

const removeSelf = process.platform === 'win32' ? `rmdir /s /q "${root}"` : `rm -rf "${root}"`;

async function main() {
  if (!targets.length) {
    console.log('JumpCut: nothing installed to remove.');
    if (!withData && fs.existsSync(home)) {
      console.log(`\nYour projects and exports are still in ${home}.`);
      console.log('Remove those too with:  npm run uninstall -- --data');
    }
    console.log(`\nTo finish, delete the folder itself:\n  ${removeSelf}`);
    return;
  }

  const total = targets.reduce((sum, t) => sum + t.bytes, 0);
  const width = Math.max(...targets.map((t) => t.label.length));

  console.log(dryRun ? 'JumpCut would remove:\n' : 'JumpCut will remove:\n');
  for (const t of targets) {
    console.log(`  ${t.label.padEnd(width)}  ${human(t.bytes).padStart(8)}  ${t.path}`);
  }
  console.log(`\n  ${'total'.padEnd(width)}  ${human(total).padStart(8)}`);

  if (withData && (projects || exported || imported)) {
    console.log('\n  ! That folder holds your work:');
    if (projects) console.log(`      ${projects} project${projects === 1 ? '' : 's'}`);
    if (imported) console.log(`      ${imported} imported file${imported === 1 ? '' : 's'}`);
    if (exported) console.log(`      ${exported} export${exported === 1 ? '' : 's'}`);
    console.log('    Footage you linked from elsewhere on disk is untouched.');
    console.log('    Everything listed above is deleted for good.');
  } else if (!withData && fs.existsSync(home)) {
    console.log(`\n  Keeping ${home} — your projects, media and exports stay put.`);
    console.log('  Add --data to remove those as well.');
  }

  const port = Number(process.env.PORT) || 5174;
  const host = process.env.HOST || '127.0.0.1';
  if (await listening(host, port)) {
    console.log(`\n  ! Something is still serving ${host}:${port} — stop JumpCut (Ctrl-C) first.`);
  }

  if (dryRun) {
    console.log('\nDry run: nothing was deleted.');
    return;
  }

  if (!assumeYes) {
    if (!process.stdin.isTTY) {
      console.error('\nNot a terminal, so nothing was deleted. Re-run with --yes to go ahead.');
      process.exit(1);
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`\nRemove ${withData ? 'all of it, projects included' : 'these'}? [y/N] `)).trim().toLowerCase();
    rl.close();
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Left everything alone.');
      return;
    }
  }

  let failed = 0;
  for (const t of targets) {
    try {
      fs.rmSync(t.path, { recursive: true, force: true, maxRetries: 3 });
      console.log(`removed  ${t.path}`);
    } catch (err) {
      failed += 1;
      console.error(`failed   ${t.path} — ${err.message}`);
    }
  }

  console.log(`\n${failed ? 'Removed what it could' : 'Removed'} ${human(total)}.`);
  console.log(`\nTo finish, delete the folder itself:\n  ${removeSelf}`);
  if (!withData && fs.existsSync(home)) {
    console.log(`\n${home} is still there with your projects and exports.`);
  }
  console.log('\nThe bundled ffmpeg went with the dependencies. If you installed one');
  console.log('system-wide just for JumpCut, and nothing else uses it:');
  console.log('  macOS    brew uninstall ffmpeg');
  console.log('  Debian   sudo apt remove ffmpeg');
  console.log('  Windows  winget uninstall Gyan.FFmpeg');

  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`jumpcut uninstall: ${err.message}`);
  process.exit(1);
});
