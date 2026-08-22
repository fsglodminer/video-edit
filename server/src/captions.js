// Caption import/export plus optional local speech-to-text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { run } from './ffmpeg.js';
import { DIRS } from './storage.js';

const toSeconds = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;

export function parseSrt(text) {
  const items = [];
  const blocks = String(text).replace(/\r\n/g, '\n').replace(/^﻿/, '').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    if (!lines.length) continue;
    const timeIdx = lines.findIndex((l) => /-->/.test(l));
    if (timeIdx === -1) continue;
    const m = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(lines[timeIdx]);
    if (!m) continue;
    const text_ = lines.slice(timeIdx + 1).join('\n').trim();
    if (!text_) continue;
    items.push({
      start: toSeconds(m[1], m[2], m[3], m[4].padEnd(3, '0')),
      end: toSeconds(m[5], m[6], m[7], m[8].padEnd(3, '0')),
      text: text_,
    });
  }
  return items;
}

export function parseVtt(text) {
  return parseSrt(String(text).replace(/^WEBVTT[^\n]*\n/, ''));
}

export function parseCaptions(text, filename = '') {
  return /\.vtt$/i.test(filename) || /^WEBVTT/.test(String(text).trim()) ? parseVtt(text) : parseSrt(text);
}

const srtTime = (sec) => {
  const s = Math.max(0, sec);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  const ms = String(Math.round((s % 1) * 1000)).padStart(3, '0');
  return `${h}:${m}:${ss},${ms}`;
};

export function toSrt(items) {
  return (items || [])
    .filter((c) => c.text && c.end > c.start)
    .map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`)
    .join('\n');
}

export function toVtt(items) {
  const body = (items || [])
    .filter((c) => c.text && c.end > c.start)
    .map((c) => `${srtTime(c.start).replace(',', '.')} --> ${srtTime(c.end).replace(',', '.')}\n${c.text}\n`)
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** Re-flow long caption lines so burned-in text stays readable on a phone. */
export function rewrap(items, { maxChars = 42, maxLines = 2 } = {}) {
  return (items || []).map((c) => {
    const words = String(c.text).replace(/\s+/g, ' ').trim().split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      if (!line) line = w;
      else if (`${line} ${w}`.length <= maxChars) line += ` ${w}`;
      else {
        lines.push(line);
        line = w;
      }
    }
    if (line) lines.push(line);
    return { ...c, text: lines.slice(0, maxLines * 4).join('\n') };
  });
}

/** Split captions into one-or-two-word chunks (the "karaoke" look Shorts use). */
export function toWordChunks(items, { wordsPerChunk = 3 } = {}) {
  const out = [];
  for (const c of items || []) {
    const words = String(c.text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!words.length) continue;
    const span = Math.max(0.05, c.end - c.start);
    const chunks = Math.ceil(words.length / wordsPerChunk);
    const per = span / chunks;
    for (let i = 0; i < chunks; i += 1) {
      out.push({
        start: c.start + i * per,
        end: c.start + (i + 1) * per,
        text: words.slice(i * wordsPerChunk, (i + 1) * wordsPerChunk).join(' '),
      });
    }
  }
  return out;
}

/** Locate a local Whisper build, if the user happens to have one. */
export function findWhisper() {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const candidates = [
    { bin: process.env.WHISPER_PATH, flavour: process.env.WHISPER_FLAVOUR || 'cpp' },
    { bin: 'whisper-cli', flavour: 'cpp' },
    { bin: 'whisper-cpp', flavour: 'cpp' },
    { bin: 'whisper', flavour: 'python' },
  ];
  for (const c of candidates) {
    if (!c.bin) continue;
    if (path.isAbsolute(c.bin) && fs.existsSync(c.bin)) return c;
    const r = spawnSync(which, [c.bin], { encoding: 'utf8', timeout: 8000 });
    if (r.status === 0) {
      const resolved = String(r.stdout).split(/\r?\n/)[0].trim();
      if (resolved) return { bin: resolved, flavour: c.flavour };
    }
  }
  return null;
}

export function whisperModelPath() {
  if (process.env.WHISPER_MODEL && fs.existsSync(process.env.WHISPER_MODEL)) return process.env.WHISPER_MODEL;
  const dirs = [path.join(DIRS.home, 'models'), path.join(os.homedir(), 'models'), '/usr/local/share/whisper', path.join(os.homedir(), '.cache', 'whisper')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const bin = fs.readdirSync(dir).filter((f) => /\.bin$/i.test(f)).sort();
    if (bin.length) return path.join(dir, bin[0]);
  }
  return null;
}

/**
 * Transcribe a media file to caption items. Requires a local whisper install;
 * callers should check `findWhisper()` and offer SRT import when it's absent.
 */
export async function transcribe(mediaPath, { language = 'auto', onLog } = {}) {
  const whisper = findWhisper();
  if (!whisper) {
    throw Object.assign(new Error('No local speech-to-text engine found. Install whisper.cpp (brew install whisper-cpp) or import an .srt file.'), { code: 'NO_WHISPER' });
  }

  const stamp = Date.now();
  const wav = path.join(DIRS.tmp, `stt-${stamp}.wav`);
  fs.mkdirSync(DIRS.tmp, { recursive: true });
  await run(['-hide_banner', '-nostdin', '-y', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);

  const outBase = path.join(DIRS.tmp, `stt-${stamp}`);
  let args;
  if (whisper.flavour === 'cpp') {
    const model = whisperModelPath();
    if (!model) {
      throw Object.assign(new Error('whisper.cpp is installed but no model (.bin) was found. Put one in ~/JumpCut/models or set WHISPER_MODEL.'), { code: 'NO_WHISPER_MODEL' });
    }
    args = ['-m', model, '-f', wav, '-osrt', '-of', outBase];
    if (language && language !== 'auto') args.push('-l', language);
  } else {
    args = [wav, '--model', process.env.WHISPER_MODEL_NAME || 'base', '--output_format', 'srt', '--output_dir', DIRS.tmp];
    if (language && language !== 'auto') args.push('--language', language);
  }

  await new Promise((resolve, reject) => {
    const child = spawn(whisper.bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => onLog?.(d.toString()));
    child.stderr.on('data', (d) => onLog?.(d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`speech-to-text exited with code ${code}`))));
  });

  const srtPath = [`${outBase}.srt`, path.join(DIRS.tmp, `${path.basename(wav, '.wav')}.srt`)].find((p) => fs.existsSync(p));
  if (!srtPath) throw new Error('Transcription finished but produced no .srt output.');
  const items = parseSrt(fs.readFileSync(srtPath, 'utf8'));

  for (const f of [wav, srtPath]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* leave temp files if they are locked */
    }
  }
  return items;
}
