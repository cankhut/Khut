const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decode(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG');
  let pos = 8;
  let width, height, depth, type, interlace;
  let palette;
  const data = [];
  while (pos < buffer.length) {
    const length = buffer.readUInt32BE(pos);
    const name = buffer.toString('ascii', pos + 4, pos + 8);
    const body = buffer.subarray(pos + 8, pos + 8 + length);
    if (name === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (name === 'PLTE') palette = body;
    else if (name === 'IDAT') data.push(body);
    else if (name === 'IEND') break;
    pos += 12 + length;
  }
  if (depth !== 8 || interlace || !(type in CHANNELS || type === 3)) throw new Error('Unsupported PNG');

  const channels = type === 3 ? 1 : CHANNELS[type];
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? pixels[(y - 1) * stride + x - channels] : 0;
      const value = [line[x], line[x] + a, line[x] + b, line[x] + ((a + b) >> 1), line[x] + paeth(a, b, c)][filter];
      pixels[y * stride + x] = value & 255;
    }
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const p = pixels.subarray(i * channels, i * channels + channels);
    const color = type === 3 ? [palette[p[0] * 3], palette[p[0] * 3 + 1], palette[p[0] * 3 + 2], 255]
      : type === 0 ? [p[0], p[0], p[0], 255]
      : type === 4 ? [p[0], p[0], p[0], p[1]]
      : type === 2 ? [p[0], p[1], p[2], 255]
      : [p[0], p[1], p[2], p[3]];
    rgba.set(color, i * 4);
  }
  return { width, height, data: rgba };
}

function chunk(name, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(name, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

function encode({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function rotate(image, turns) {
  let { width, height, data } = image;
  for (let t = 0; t < ((turns % 4) + 4) % 4; t++) {
    const out = Buffer.alloc(data.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) data.copy(out, (x * height + (height - 1 - y)) * 4, (y * width + x) * 4, (y * width + x) * 4 + 4);
    }
    [width, height, data] = [height, width, out];
  }
  return { width, height, data };
}

function grey(image) {
  const data = Buffer.from(image.data);
  for (let i = 0; i < data.length; i += 4) {
    const v = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  return { ...image, data };
}

function scale(image, factor) {
  const width = image.width * factor;
  const height = image.height * factor;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.max(0, (y + 0.5) / factor - 0.5));
    const y0 = Math.floor(sy);
    const y1 = Math.min(image.height - 1, y0 + 1);
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.max(0, (x + 0.5) / factor - 0.5));
      const x0 = Math.floor(sx);
      const x1 = Math.min(image.width - 1, x0 + 1);
      for (let c = 0; c < 4; c++) {
        const p = (yy, xx) => image.data[(yy * image.width + xx) * 4 + c];
        const top = p(y0, x0) + (p(y0, x1) - p(y0, x0)) * (sx - x0);
        const bottom = p(y1, x0) + (p(y1, x1) - p(y1, x0)) * (sx - x0);
        data[(y * width + x) * 4 + c] = Math.round(top + (bottom - top) * (sy - y0));
      }
    }
  }
  return { width, height, data };
}

module.exports = { decode, encode, rotate, grey, scale };
