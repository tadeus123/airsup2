import { inflateSync } from "node:zlib";

type RgbaImage = { width: number; height: number; data: Buffer };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Minimal 8-bit RGB/RGBA PNG decoder (no interlace). */
export function decodePngRgba(buf: Buffer): RgbaImage | null {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  let off = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idats: Buffer[] = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const start = off + 8;
    const end = start + len;
    if (end + 4 > buf.length) break;
    const chunk = buf.subarray(start, end);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8]!;
      colorType = chunk[9]!;
      if (chunk[12] !== 0) return null;
    } else if (type === "IDAT") {
      idats.push(Buffer.from(chunk));
    } else if (type === "IEND") {
      break;
    }
    off = end + 4;
  }
  if (!width || !height || bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    return null;
  }
  const bpp = colorType === 6 ? 4 : 3;
  let inflated: Buffer;
  try {
    inflated = inflateSync(Buffer.concat(idats));
  } catch {
    return null;
  }
  const stride = width * bpp;
  const raw = Buffer.alloc(height * stride);
  let src = 0;
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    if (src >= inflated.length) return null;
    const filter = inflated[src++]!;
    inflated.copy(cur, 0, src, src + stride);
    src += stride;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bpp ? cur[i - bpp]! : 0;
      const up = prev[i]!;
      const upLeft = i >= bpp ? prev[i - bpp]! : 0;
      const x = cur[i]!;
      if (filter === 0) cur[i] = x;
      else if (filter === 1) cur[i] = (x + left) & 255;
      else if (filter === 2) cur[i] = (x + up) & 255;
      else if (filter === 3) cur[i] = (x + ((left + up) >> 1)) & 255;
      else if (filter === 4) cur[i] = (x + paeth(left, up, upLeft)) & 255;
      else return null;
    }
    cur.copy(prev);
    cur.copy(raw, y * stride);
  }
  if (bpp === 4) return { width, height, data: raw };
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < raw.length; i += 3, j += 4) {
    rgba[j] = raw[i]!;
    rgba[j + 1] = raw[i + 1]!;
    rgba[j + 2] = raw[i + 2]!;
    rgba[j + 3] = 255;
  }
  return { width, height, data: rgba };
}

function isSendAccent(r: number, g: number, b: number): boolean {
  const blue = b > 150 && b - r > 35 && b - g > 15 && r < 190;
  const white = r > 215 && g > 215 && b > 215 && Math.abs(r - g) < 18;
  return blue || white;
}

/** ChatGPT send control: small accent circle on the right of the composer. */
export function findChatGptSendButton(
  img: RgbaImage
): { x: number; y: number } | null {
  const { width, height, data } = img;
  const x0 = Math.floor(width * 0.72);
  const x1 = Math.floor(width * 0.98);
  const y0 = Math.floor(height * 0.48);
  const y1 = Math.floor(height * 0.92);
  let sumX = 0;
  let sumY = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * width + x) * 4;
      if (isSendAccent(data[i]!, data[i + 1]!, data[i + 2]!)) {
        sumX += x;
        sumY += y;
        n += 1;
      }
    }
  }
  if (n < 40 || n > 3500) return null;
  return { x: Math.round(sumX / n), y: Math.round(sumY / n) };
}
