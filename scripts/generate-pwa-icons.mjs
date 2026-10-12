// Deterministic, dependency-free SVG icons plus matching PNG fallbacks for
// Windows launchers/installability checks that prefer raster manifest icons.
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const directory = new URL('../public/icons/', import.meta.url);
await mkdir(directory, { recursive: true });
const orange = [249, 115, 22];
const letter = [[166,356],[166,156],[211,156],[301,285],[301,156],[346,156],[346,356],[302,356],[211,226],[211,356]];
const path = 'M' + letter.map(point => point.join(' ')).join('L') + 'Z';
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, body, checksum]);
}
function inLetter(x, y) {
  let inside = false;
  for (let i = 0, j = letter.length - 1; i < letter.length; j = i++) {
    const [xi, yi] = letter[i], [xj, yj] = letter[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function png(size) {
  const pixels = Buffer.alloc(size * (1 + size * 4));
  const samples = 4, scale = 512 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let coverage = 0, white = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const px = (x + (sx + .5) / samples) * scale, py = (y + (sy + .5) / samples) * scale;
      if ((px - 256) ** 2 + (py - 256) ** 2 <= 244 ** 2) {
        coverage++;
        if (inLetter(px, py)) white++;
      }
    }
    const at = y * (1 + size * 4) + 1 + x * 4;
    if (coverage) {
      for (let channel = 0; channel < 3; channel++) pixels[at + channel] = Math.round((white * 255 + (coverage - white) * orange[channel]) / coverage);
      pixels[at + 3] = Math.round(coverage * 255 / (samples * samples));
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; // Eight-bit RGBA.
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
for (const size of [192, 512]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" role="img" aria-labelledby="title"><title id="title">NOVA</title><circle cx="256" cy="256" r="244" fill="#f97316"/><path d="${path}" fill="#ffffff"/></svg>\n`;
  await writeFile(new URL(`nova-${size}.svg`, directory), svg);
  await writeFile(new URL(`nova-${size}.png`, directory), png(size));
}
console.log('Wrote 192px and 512px NOVA icons (SVG + PNG).');
