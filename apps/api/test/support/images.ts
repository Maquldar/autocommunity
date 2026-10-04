import sharp from 'sharp';

/** A real JPEG carrying EXIF with GPS coordinates and an orientation tag. */
export function jpegWithGps(width = 64, height = 48): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'TestCam', Model: 'GPS-1' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '43/1 14/1 2000/100',
        GPSLongitudeRef: 'E',
        GPSLongitude: '76/1 53/1 2300/100',
      },
    })
    // EXIF orientation 6 = rotate 90° clockwise to display.
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

/** Smallest buffer recognised as Ogg Opus by magic bytes (OggS page + OpusHead at offset 28). */
export function oggOpus(extraBytes = 200): Buffer {
  const buf = Buffer.alloc(28 + 8 + extraBytes, 1);
  buf.write('OggS', 0, 'latin1');
  buf.write('OpusHead', 28, 'latin1');
  return buf;
}

export const pngImage = (size = 32): Promise<Buffer> =>
  sharp({ create: { width: size, height: size, channels: 4, background: '#3366ff' } }).png().toBuffer();

/** Minimal WebM (EBML header with DocType "webm") as produced by MediaRecorder for audio. */
export function webmAudio(extraBytes = 200): Buffer {
  const header = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84]);
  return Buffer.concat([header, Buffer.from('webm', 'latin1'), Buffer.from([0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02]), Buffer.alloc(extraBytes, 0)]);
}
