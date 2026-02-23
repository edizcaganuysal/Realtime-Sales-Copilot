/**
 * Audio transcoding utilities for bridging Twilio (mulaw G.711 8 kHz)
 * and OpenAI Realtime API (PCM16 16 kHz).
 *
 * All functions are pure TypeScript — no native addons or external deps.
 */

// G.711 mulaw decode table (8-bit → 16-bit linear PCM)
const MULAW_DECODE_TABLE: Int16Array = (() => {
  const table = new Int16Array(256);
  for (let i = 0; i < 256; i++) {
    let mulaw = ~i & 0xff;
    const sign = mulaw & 0x80;
    mulaw &= 0x7f;
    const exponent = (mulaw >> 4) & 0x07;
    const mantissa = mulaw & 0x0f;
    let sample = ((mantissa << 1) + 33) << exponent;
    sample -= 33;
    table[i] = sign ? -sample : sample;
  }
  return table;
})();

/**
 * Decode G.711 mulaw bytes to 16-bit linear PCM samples.
 */
export function mulawDecode(mulaw: Uint8Array): Int16Array {
  const out = new Int16Array(mulaw.length);
  for (let i = 0; i < mulaw.length; i++) {
    out[i] = MULAW_DECODE_TABLE[mulaw[i]];
  }
  return out;
}

/**
 * Encode 16-bit linear PCM samples to G.711 mulaw bytes.
 */
export function mulawEncode(pcm: Int16Array): Uint8Array {
  const MULAW_MAX = 0x1fff;
  const BIAS = 0x84;
  const out = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let sample = pcm[i];
    let sign = 0;
    if (sample < 0) {
      sample = -sample;
      sign = 0x80;
    }
    sample += BIAS;
    if (sample > MULAW_MAX) sample = MULAW_MAX;

    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {
      /* find highest set bit */
    }
    const mantissa = (sample >> (exponent + 3)) & 0x0f;
    const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
    out[i] = mulawByte;
  }
  return out;
}

/**
 * Upsample from 8 kHz to 16 kHz using linear interpolation (2× factor).
 */
export function upsample8to16(input: Int16Array): Int16Array {
  const out = new Int16Array(input.length * 2);
  for (let i = 0; i < input.length - 1; i++) {
    out[i * 2] = input[i];
    out[i * 2 + 1] = Math.round((input[i] + input[i + 1]) / 2);
  }
  // Last sample — duplicate
  out[(input.length - 1) * 2] = input[input.length - 1];
  out[(input.length - 1) * 2 + 1] = input[input.length - 1];
  return out;
}

/**
 * Downsample from 16 kHz to 8 kHz by averaging adjacent pairs (0.5× factor).
 */
export function downsample16to8(input: Int16Array): Int16Array {
  const outLen = Math.floor(input.length / 2);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = Math.round((input[i * 2] + input[i * 2 + 1]) / 2);
  }
  return out;
}

/**
 * Full pipeline: Twilio mulaw 8 kHz base64 → PCM16 16 kHz base64 (for OpenAI Realtime).
 */
export function twilioToOpenAI(base64Mulaw: string): string {
  const mulaw = new Uint8Array(Buffer.from(base64Mulaw, 'base64'));
  const pcm8k = mulawDecode(mulaw);
  const pcm16k = upsample8to16(pcm8k);
  // Convert Int16Array to Buffer (little-endian)
  const buf = Buffer.allocUnsafe(pcm16k.length * 2);
  for (let i = 0; i < pcm16k.length; i++) {
    buf.writeInt16LE(pcm16k[i], i * 2);
  }
  return buf.toString('base64');
}

/**
 * Full pipeline: OpenAI PCM16 16 kHz base64 → Twilio mulaw 8 kHz base64.
 */
export function openAIToTwilio(base64Pcm16: string): string {
  const buf = Buffer.from(base64Pcm16, 'base64');
  const pcm16k = new Int16Array(buf.length / 2);
  for (let i = 0; i < pcm16k.length; i++) {
    pcm16k[i] = buf.readInt16LE(i * 2);
  }
  const pcm8k = downsample16to8(pcm16k);
  const mulaw = mulawEncode(pcm8k);
  return Buffer.from(mulaw).toString('base64');
}
