export function createAudioPacket(audioData: Float32Array, type: number): Uint8Array {
  const LONG_BYTE = 8;
  const SHORT_BYTE = 2;
  const totalLength = 2 * LONG_BYTE + audioData.length * SHORT_BYTE;

  const buffer = new ArrayBuffer(totalLength);
  const dv = new DataView(buffer);
  const isLittleEndian = true;

  dv.setBigInt64(0, BigInt(type), isLittleEndian);
  dv.setBigInt64(LONG_BYTE, BigInt(0), isLittleEndian);

  let byteOffset = 2 * LONG_BYTE;
  for (let i = 0; i < audioData.length; i++) {
    const sample = Math.max(-1, Math.min(1, audioData[i]));
    const int16Sample = Math.max(
      -32768,
      Math.min(32767, Math.round(sample * 32767))
    );
    dv.setInt16(byteOffset, int16Sample, isLittleEndian);
    byteOffset += SHORT_BYTE;
  }

  return new Uint8Array(buffer);
}
