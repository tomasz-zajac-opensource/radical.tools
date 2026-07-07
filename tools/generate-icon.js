#!/usr/bin/env node
// Generates tools/vscode-radical/images/icon.png (128×128)
// Uses only Node.js built-ins (zlib, fs, path) — no dependencies.

const zlib = require('zlib')
const fs   = require('fs')
const path = require('path')

const SIZE = 128

// ── PNG encoder ───────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const tb  = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4);  len.writeUInt32BE(data.length)
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tb, data])))
  return Buffer.concat([len, tb, data, crcBuf])
}

// ── Pixel canvas ──────────────────────────────────────────────────────────────

const pixels = new Uint8Array(SIZE * SIZE * 3)   // RGB

function px(x, y, r, g, b) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return
  const i = (y * SIZE + x) * 3
  pixels[i] = r;  pixels[i + 1] = g;  pixels[i + 2] = b
}

function fillRect(x1, y1, x2, y2, c) {
  for (let y = y1; y < y2; y++)
    for (let x = x1; x < x2; x++)
      px(x, y, c[0], c[1], c[2])
}

function disc(cx, cy, r, c) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r)
        px(x, y, c[0], c[1], c[2])
}

function line(x1, y1, x2, y2, c, w = 2) {
  const dx = x2 - x1, dy = y2 - y1
  const steps = Math.max(Math.abs(dx), Math.abs(dy), 1)
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x1 + dx * i / steps)
    const y = Math.round(y1 + dy * i / steps)
    for (let tx = -w; tx <= w; tx++)
      for (let ty = -w; ty <= w; ty++)
        if (tx * tx + ty * ty <= w * w)
          px(x + tx, y + ty, c[0], c[1], c[2])
  }
}

// Rounded-corner mask: clear corners to transparent by drawing BG over them
function roundCorners(r, bg) {
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const cx = x < r ? r : x >= SIZE - r ? SIZE - r - 1 : -1
      const cy = y < r ? r : y >= SIZE - r ? SIZE - r - 1 : -1
      if (cx >= 0 && cy >= 0 && (x - cx) ** 2 + (y - cy) ** 2 > r * r)
        px(x, y, bg[0], bg[1], bg[2])
    }
}

// ── Design ────────────────────────────────────────────────────────────────────

const BG   = [13,  19,  33 ]   // #0d1321  deepest navy
const CARD = [22,  34,  60 ]   // #16223c  card bg
const BLUE = [56,  123, 243]   // #387bf3  primary blue
const LBLU = [129, 183, 255]   // #81b7ff  light blue
const WHT  = [220, 231, 254]   // #dce7fe  near-white

// Background fill
fillRect(0, 0, SIZE, SIZE, BG)

// Inner card
fillRect(10, 10, SIZE - 10, SIZE - 10, CARD)

// ── Graph nodes: C4-style hierarchy ─────────────────────────────────────────
// Layout:  outer ring of 4 + center hub + 2 small satellites

const C = [64, 64]   // center
const N = [64, 28]   // north
const W = [26, 64]   // west
const E = [102, 64]  // east
const S = [64, 100]  // south
const NW = [38, 38]
const NE = [90, 38]

// Edges
line(...N, ...C, BLUE, 2)
line(...W, ...C, BLUE, 2)
line(...E, ...C, BLUE, 2)
line(...S, ...C, BLUE, 2)
line(...NW, ...N, LBLU, 1)
line(...NE, ...N, LBLU, 1)
line(...NW, ...W, LBLU, 1)
line(...NE, ...E, LBLU, 1)

// Outer nodes (hollow: fill BG inside)
for (const [nx, ny] of [N, W, E, S]) {
  disc(nx, ny, 9, BLUE)
  disc(nx, ny, 6, CARD)
  disc(nx, ny, 3, LBLU)
}

// Satellite nodes (smaller)
for (const [nx, ny] of [NW, NE]) {
  disc(nx, ny, 6, BLUE)
  disc(nx, ny, 4, CARD)
  disc(nx, ny, 2, LBLU)
}

// Center hub (bright, larger)
disc(C[0], C[1], 13, BLUE)
disc(C[0], C[1], 9,  CARD)
disc(C[0], C[1], 6,  WHT)

// Rounded corners
roundCorners(14, BG)

// ── Encode PNG ────────────────────────────────────────────────────────────────

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8   // bit depth
ihdr[9] = 2   // color type: RGB (no alpha — vsce icon requirement)

const rows = []
for (let y = 0; y < SIZE; y++) {
  rows.push(0)   // filter byte: None
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 3
    rows.push(pixels[i], pixels[i + 1], pixels[i + 2])
  }
}
const compressed = zlib.deflateSync(Buffer.from(rows))

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const png = Buffer.concat([
  sig,
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0)),
])

const outDir  = path.join(__dirname, 'vscode-radical', 'images')
const outFile = path.join(outDir, 'icon.png')
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(outFile, png)
console.log(`icon.png  ${png.length} bytes  →  ${outFile}`)
