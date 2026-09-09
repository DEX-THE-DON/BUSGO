/**
 * Lightweight Zero-Dependency QR Code Generator in TypeScript
 * Implements ISO/IEC 18004 QR Code Model 2 with Byte mode & Reed-Solomon ECC.
 * Generates crisp, scannable SVGs for transit boarding passes.
 */

// Galois Field GF(256) arithmetic for Reed-Solomon codes
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(function initGF() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = val;
    EXP_TABLE[i + 255] = val;
    LOG_TABLE[val] = i;
    val <<= 1;
    if (val & 256) {
      val ^= 0x11d; // 285
    }
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x] + LOG_TABLE[y]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const nextPoly = new Uint8Array(poly.length + 1);
    const factor = EXP_TABLE[i];
    for (let j = 0; j < poly.length; j++) {
      nextPoly[j] ^= gfMul(poly[j], factor);
      nextPoly[j + 1] ^= poly[j];
    }
    poly = nextPoly;
  }
  return poly;
}

function calculateECC(data: Uint8Array, eccLen: number): Uint8Array {
  const gen = rsGeneratorPoly(eccLen);
  const remainder = new Uint8Array(eccLen);

  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    for (let j = 0; j < eccLen - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    remainder[eccLen - 1] = gfMul(gen[eccLen], factor);
  }
  return remainder;
}

export interface QRCodeMatrix {
  size: number;
  modules: boolean[][];
}

/**
 * Encodes text into a QR Code matrix.
 * Supports Version 1-4 (up to 78 bytes) with Medium error correction.
 */
export function generateQRMatrix(text: string): QRCodeMatrix {
  const bytes = new TextEncoder().encode(text);
  
  // Choose smallest version that fits:
  // V1: 16 bytes (M), V2: 28 bytes (M), V3: 44 bytes (M), V4: 64 bytes (M)
  let version = 1;
  let totalDataBytes = 16;
  let ecBytes = 10;
  
  if (bytes.length <= 14) {
    version = 1;
    totalDataBytes = 16;
    ecBytes = 10;
  } else if (bytes.length <= 26) {
    version = 2;
    totalDataBytes = 28;
    ecBytes = 16;
  } else if (bytes.length <= 42) {
    version = 3;
    totalDataBytes = 44;
    ecBytes = 26;
  } else {
    version = 4;
    totalDataBytes = 64;
    ecBytes = 36;
  }

  const size = version * 4 + 17;
  const modules: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null)
  );

  // 1. Finder patterns at (0,0), (0, size-7), (size-7, 0)
  function drawFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const mr = row + r;
        const mc = col + c;
        if (mr >= 0 && mr < size && mc >= 0 && mc < size) {
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
            const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            modules[mr][mc] = isBorder || isCenter;
          } else {
            modules[mr][mc] = false; // Separator
          }
        }
      }
    }
  }

  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // 2. Alignment pattern for version >= 2
  if (version >= 2) {
    const alignPos = size - 7;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
        const isCenter = r === 0 && c === 0;
        modules[alignPos + r][alignPos + c] = isBorder || isCenter;
      }
    }
  }

  // 3. Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (modules[6][i] === null) modules[6][i] = i % 2 === 0;
    if (modules[i][6] === null) modules[i][6] = i % 2 === 0;
  }

  // Dark module
  modules[size - 8][8] = true;

  // 4. Reserve format info areas
  for (let i = 0; i < 9; i++) {
    if (modules[8][i] === null) modules[8][i] = false;
    if (modules[i][8] === null) modules[i][8] = false;
  }
  for (let i = size - 8; i < size; i++) {
    if (modules[8][i] === null) modules[8][i] = false;
    if (modules[i][8] === null) modules[i][8] = false;
  }

  // 5. Data Bitstream: Byte mode (0100) + character count + data + padding
  const bitStream: number[] = [];
  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bitStream.push((val >> i) & 1);
    }
  }

  pushBits(0b0100, 4); // Byte mode indicator
  pushBits(bytes.length, 8); // Character count indicator
  for (const b of bytes) {
    pushBits(b, 8);
  }

  // Terminator (up to 4 zeroes)
  const maxDataBits = totalDataBytes * 8;
  const termLen = Math.min(4, maxDataBits - bitStream.length);
  pushBits(0, termLen);

  // Pad to multiple of 8
  while (bitStream.length % 8 !== 0) {
    bitStream.push(0);
  }

  // Pad bytes (0xEC, 0x11)
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bitStream.length < maxDataBits) {
    pushBits(padBytes[padIdx % 2], 8);
    padIdx++;
  }

  // Group into data bytes
  const dataBytes = new Uint8Array(totalDataBytes);
  for (let i = 0; i < totalDataBytes; i++) {
    let byteVal = 0;
    for (let bit = 0; bit < 8; bit++) {
      byteVal = (byteVal << 1) | bitStream[i * 8 + bit];
    }
    dataBytes[i] = byteVal;
  }

  // Calculate Reed-Solomon Error Correction Code
  const ecc = calculateECC(dataBytes, ecBytes);

  // Interleaved final codeword stream
  const finalCodewords = new Uint8Array(totalDataBytes + ecBytes);
  finalCodewords.set(dataBytes, 0);
  finalCodewords.set(ecc, totalDataBytes);

  // Convert final codewords to all bits
  const allBits: number[] = [];
  for (const cw of finalCodewords) {
    for (let i = 7; i >= 0; i--) {
      allBits.push((cw >> i) & 1);
    }
  }

  // 6. Place data bits (zigzag right to left, skipping function patterns)
  let bitIdx = 0;
  let dir = -1; // up
  let row = size - 1;

  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol--; // Skip vertical timing pattern column

    while (row >= 0 && row < size) {
      for (let colOffset = 0; colOffset < 2; colOffset++) {
        const c = rightCol - colOffset;
        if (modules[row][c] === null) {
          const bit = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
          // Apply Standard Mask Pattern 0: (row + col) % 2 == 0
          const mask = (row + c) % 2 === 0;
          modules[row][c] = (bit === 1) !== mask;
        }
      }
      row += dir;
    }
    dir = -dir;
    row += dir;
  }

  // 7. Write Format Information (Mask 0, ECC Level M: 0x5412)
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];

  // Top-left
  for (let i = 0; i < 6; i++) modules[8][i] = formatBits[i] === 1;
  modules[8][7] = formatBits[6] === 1;
  modules[8][8] = formatBits[7] === 1;
  modules[7][8] = formatBits[8] === 1;
  for (let i = 9; i < 15; i++) modules[14 - i][8] = formatBits[i] === 1;

  // Split around finder patterns
  for (let i = 0; i < 7; i++) modules[size - 1 - i][8] = formatBits[i] === 1;
  for (let i = 7; i < 15; i++) modules[8][size - 15 + i] = formatBits[i] === 1;

  // Convert nullable boolean to pure boolean
  const finalModules: boolean[][] = modules.map((r) =>
    r.map((c) => (c === null ? false : c))
  );

  return { size, modules: finalModules };
}

/**
 * Generates an SVG path string for the QR code modules.
 */
export function getQRCodeSVGPath(matrix: QRCodeMatrix): string {
  let path = '';
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.modules[r][c]) {
        path += `M${c},${r}h1v1h-1z `;
      }
    }
  }
  return path;
}
