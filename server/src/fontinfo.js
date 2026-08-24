// Reads the family name out of a TTF/OTF/TTC so libass can actually match the
// font we hand it — the filename ("DejaVuSans.ttf") is not the family name
// ("DejaVu Sans"), and a mismatch silently falls back to something else.
import fs from 'node:fs';
import path from 'node:path';

const cache = new Map();

function readNameTable(buf, base) {
  const format = buf.readUInt16BE(base);
  const count = buf.readUInt16BE(base + 2);
  const stringOffset = buf.readUInt16BE(base + 4);
  if (format > 1) return null;

  const found = new Map(); // nameID -> string
  for (let i = 0; i < count; i += 1) {
    const rec = base + 6 + i * 12;
    if (rec + 12 > buf.length) break;
    const platformID = buf.readUInt16BE(rec);
    const nameID = buf.readUInt16BE(rec + 6);
    if (nameID !== 1 && nameID !== 16) continue;
    const length = buf.readUInt16BE(rec + 8);
    const offset = buf.readUInt16BE(rec + 10);
    const start = base + stringOffset + offset;
    if (start + length > buf.length) continue;
    const raw = buf.subarray(start, start + length);
    const text = platformID === 1 ? raw.toString('latin1') : raw.toString('utf16le').replace(/\0/g, '') || swap16(raw);
    const clean = (platformID === 1 ? text : swap16(raw)).replace(/\0/g, '').trim();
    if (!clean) continue;
    // nameID 16 (typographic family) wins over 1 when both exist.
    if (!found.has(nameID)) found.set(nameID, clean);
  }
  return found.get(16) || found.get(1) || null;
}

function swap16(buf) {
  const out = Buffer.from(buf);
  for (let i = 0; i + 1 < out.length; i += 2) {
    const t = out[i];
    out[i] = out[i + 1];
    out[i + 1] = t;
  }
  return out.toString('utf16le');
}

/** Best-effort family name; falls back to a cleaned-up filename. */
export function familyName(file) {
  if (!file) return 'Sans';
  if (cache.has(file)) return cache.get(file);

  let name = null;
  try {
    const buf = fs.readFileSync(file);
    let offset = 0;
    if (buf.length > 16 && buf.toString('latin1', 0, 4) === 'ttcf') offset = buf.readUInt32BE(12);
    const numTables = buf.readUInt16BE(offset + 4);
    for (let i = 0; i < numTables; i += 1) {
      const rec = offset + 12 + i * 16;
      if (rec + 16 > buf.length) break;
      if (buf.toString('latin1', rec, rec + 4) === 'name') {
        name = readNameTable(buf, buf.readUInt32BE(rec + 8));
        break;
      }
    }
  } catch {
    /* unreadable font: fall through to the filename */
  }

  if (!name) {
    name = path
      .basename(file)
      .replace(/\.(ttf|otf|ttc)$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();
  }
  cache.set(file, name);
  return name;
}
