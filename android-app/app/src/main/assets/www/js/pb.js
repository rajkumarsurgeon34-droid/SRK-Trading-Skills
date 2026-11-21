// Minimal protobuf reader for HDFC Securities' market-data feed (GenericDTO schema).
// Only the fields SRK Trading needs are decoded; everything else is skipped.

class Reader {
  constructor(buf) { this.b = buf; this.p = 0; this.end = buf.length; }
  varint() {
    let lo = 0, hi = 0, shift = 0, byte;
    do {
      if (this.p >= this.end) throw new Error('truncated varint');
      byte = this.b[this.p++];
      if (shift < 28) lo |= (byte & 0x7f) << shift;
      else if (shift === 28) { lo |= (byte & 0x0f) << 28; hi |= (byte & 0x7f) >> 4; }
      else hi |= (byte & 0x7f) << (shift - 32);
      shift += 7;
    } while (byte & 0x80);
    return (hi >>> 0) * 4294967296 + (lo >>> 0);
  }
  double() {
    if (this.p + 8 > this.end) throw new Error('truncated double');
    const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 8).getFloat64(0, true);
    this.p += 8; return v;
  }
  bytes() { const n = this.varint(); if (this.p + n > this.end) throw new Error('truncated bytes'); const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.p += 8;
    else if (wire === 2) this.bytes();
    else if (wire === 5) this.p += 4;
    else throw new Error('bad wire type ' + wire);
  }
  *fields() {
    while (this.p < this.end) { const tag = this.varint(); yield [Math.floor(tag / 8), tag & 7]; }
  }
}

const toSigned64 = (n) => (n > 2 ** 63 ? n - 2 ** 64 : n);

function decodeMbp(buf) {
  const r = new Reader(buf), o = {};
  for (const [f, w] of r.fields()) {
    if (w === 1 && [1, 5, 6, 7, 8, 11].includes(f)) {
      const v = r.double();
      o[{ 1: 'ltp', 5: 'open', 6: 'high', 7: 'close', 8: 'low', 11: 'avg' }[f]] = v;
    } else if (w === 0 && [9, 17, 2].includes(f)) {
      const v = r.varint();
      o[{ 9: 'volume', 17: 'oi', 2: 'ltt' }[f]] = v;
    } else r.skip(w);
  }
  return o;
}
function decodeIndex(buf) {
  const r = new Reader(buf), o = {};
  for (const [f, w] of r.fields()) {
    if (w === 1 && f >= 2 && f <= 9) {
      o[{ 2: 'ltp', 3: 'high', 4: 'low', 5: 'open', 6: 'close', 7: 'pct', 8: 'yearHigh', 9: 'yearLow' }[f]] = r.double();
    } else if (w === 2 && f === 1) o.name = new TextDecoder().decode(r.bytes());
    else r.skip(w);
  }
  return o;
}
export function decodePacket(buf) {
  const r = new Reader(buf), o = { instrumentId: 0, packetType: 0 };
  for (const [f, w] of r.fields()) {
    if (f === 1 && w === 0) o.instrumentId = toSigned64(r.varint());
    else if (f === 2 && w === 2) o.mbp = decodeMbp(r.bytes());
    else if (f === 3 && w === 2) o.index = decodeIndex(r.bytes());
    else if (f === 9 && w === 0) o.packetType = r.varint();
    else r.skip(w);
  }
  return o;
}
/** Decode one feed frame: a GenericDTOList (field 1 repeated), or a bare GenericDTO. */
export function decodeFrame(buf) {
  try {
    const r = new Reader(buf), out = [];
    for (const [f, w] of r.fields()) {
      if (f === 1 && w === 2) out.push(decodePacket(r.bytes()));
      else r.skip(w);
    }
    if (out.length) return out;
  } catch { /* fall through to single packet */ }
  try { return [decodePacket(buf)]; } catch { return []; }
}
export const PACKET = { NSE_CM_ALL: 0, NSE_INDEX: 2, NSE_FO_ALL: 3, BSE_CM: 4, BSE_INDEX: 5, BSE_FO_ALL: 6, NSE_FO_OI: 14, BSE_FO_OI: 15, HEARTBEAT: 16 };
export const PACKET_EXCHANGE = { 0: 'NSE', 10: 'NSE', 3: 'NFO', 13: 'NFO', 14: 'NFO', 17: 'NFO', 4: 'BSE', 6: 'BFO', 15: 'BFO', 18: 'BFO', 2: 'NSE_INDEX', 5: 'BSE_INDEX' };
export function b64ToBytes(b64) {
  const s = atob(b64); const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ─── encoder (tests only): build frames to check the decoder ────────────────
export function encodeForTest(packets) {
  const bytes = [];
  const varint = (arr, n) => { while (n >= 128) { arr.push((n % 128) | 128); n = Math.floor(n / 128); } arr.push(n); };
  const tag = (arr, f, w) => varint(arr, f * 8 + w);
  const dbl = (arr, f, v) => { tag(arr, f, 1); const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); arr.push(...b); };
  const sub = (arr, f, inner) => { tag(arr, f, 2); varint(arr, inner.length); arr.push(...inner); };
  for (const p of packets) {
    const pk = [];
    tag(pk, 1, 0); varint(pk, p.instrumentId);
    if (p.mbp) { const m = []; dbl(m, 1, p.mbp.ltp); dbl(m, 5, p.mbp.open); dbl(m, 6, p.mbp.high); dbl(m, 7, p.mbp.close); dbl(m, 8, p.mbp.low); tag(m, 9, 0); varint(m, p.mbp.volume); tag(m, 17, 0); varint(m, p.mbp.oi); sub(pk, 2, m); }
    if (p.index) { const m = []; const nb = [...new TextEncoder().encode(p.index.name)]; sub(m, 1, nb); dbl(m, 2, p.index.ltp); dbl(m, 3, p.index.high); dbl(m, 4, p.index.low); dbl(m, 5, p.index.open); dbl(m, 6, p.index.close); sub(pk, 3, m); }
    tag(pk, 9, 0); varint(pk, p.packetType);
    sub(bytes, 1, pk);
  }
  return new Uint8Array(bytes);
}
