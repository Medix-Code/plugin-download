function buildCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

const CRC32_TABLE = buildCrc32Table();

function getCrc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getDosDateTimeParts(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    ((date.getHours() & 0x1f) << 11) |
    ((date.getMinutes() & 0x3f) << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    (((year - 1980) & 0x7f) << 9) |
    (((date.getMonth() + 1) & 0x0f) << 5) |
    (date.getDate() & 0x1f);

  return {
    dosTime,
    dosDate,
  };
}

function concatenateUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}

export function createZipArchive(entries) {
  const archiveDate = new Date();
  const { dosTime, dosDate } = getDosDateTimeParts(archiveDate);
  const localParts = [];
  const centralDirectoryParts = [];
  let localOffset = 0;

  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localHeaderView = new DataView(localHeader.buffer);
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralHeaderView = new DataView(centralHeader.buffer);
    const crc32 = getCrc32(entry.bytes);

    localHeaderView.setUint32(0, 0x04034b50, true);
    localHeaderView.setUint16(4, 20, true);
    localHeaderView.setUint16(6, 0x0800, true);
    localHeaderView.setUint16(8, 0, true);
    localHeaderView.setUint16(10, dosTime, true);
    localHeaderView.setUint16(12, dosDate, true);
    localHeaderView.setUint32(14, crc32, true);
    localHeaderView.setUint32(18, entry.bytes.length, true);
    localHeaderView.setUint32(22, entry.bytes.length, true);
    localHeaderView.setUint16(26, nameBytes.length, true);
    localHeaderView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    centralHeaderView.setUint32(0, 0x02014b50, true);
    centralHeaderView.setUint16(4, 20, true);
    centralHeaderView.setUint16(6, 20, true);
    centralHeaderView.setUint16(8, 0x0800, true);
    centralHeaderView.setUint16(10, 0, true);
    centralHeaderView.setUint16(12, dosTime, true);
    centralHeaderView.setUint16(14, dosDate, true);
    centralHeaderView.setUint32(16, crc32, true);
    centralHeaderView.setUint32(20, entry.bytes.length, true);
    centralHeaderView.setUint32(24, entry.bytes.length, true);
    centralHeaderView.setUint16(28, nameBytes.length, true);
    centralHeaderView.setUint16(30, 0, true);
    centralHeaderView.setUint16(32, 0, true);
    centralHeaderView.setUint16(34, 0, true);
    centralHeaderView.setUint16(36, 0, true);
    centralHeaderView.setUint32(38, 0, true);
    centralHeaderView.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, entry.bytes);
    centralDirectoryParts.push(centralHeader);
    localOffset += localHeader.length + entry.bytes.length;
  }

  const centralDirectory = concatenateUint8Arrays(centralDirectoryParts);
  const endRecord = new Uint8Array(22);
  const endRecordView = new DataView(endRecord.buffer);

  endRecordView.setUint32(0, 0x06054b50, true);
  endRecordView.setUint16(4, 0, true);
  endRecordView.setUint16(6, 0, true);
  endRecordView.setUint16(8, entries.length, true);
  endRecordView.setUint16(10, entries.length, true);
  endRecordView.setUint32(12, centralDirectory.length, true);
  endRecordView.setUint32(16, localOffset, true);
  endRecordView.setUint16(20, 0, true);

  return new Blob([...localParts, centralDirectory, endRecord], {
    type: "application/zip",
  });
}
