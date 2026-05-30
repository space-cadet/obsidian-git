#!/usr/bin/env node

/**
 * Build Plugin Archive Bundle
 *
 * Creates a distributable zip archive containing the built plugin files.
 * Uses Node.js built-in modules only — no external dependencies.
 * The archive can be extracted into an Obsidian vault's .obsidian/plugins/ directory.
 *
 * Usage:
 *   node scripts/build-archive.mjs          # Creates obsidian-git-sync-v1.0.0.zip
 *   node scripts/build-archive.mjs --name   # Creates obsidian-git-sync.zip (no version)
 */

import { readFileSync, existsSync, mkdirSync, createWriteStream, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const noVersion = process.argv.includes("--name");

// Read manifest for plugin ID and version
const manifestPath = join(rootDir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("❌ manifest.json not found");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
const { id, version } = manifest;

// Determine archive name
const archiveName = noVersion ? `${id}.zip` : `${id}-v${version}.zip`;
const archivePath = join(rootDir, "dist", archiveName);

// Files to include in the archive (relative to project root)
const filesToInclude = [
  "main.js",
  "manifest.json",
  "versions.json",
  "README.md",
];

// Validate that required files exist
const missing = filesToInclude.filter((f) => !existsSync(join(rootDir, f)));
if (missing.length > 0) {
  console.error(`❌ Missing required files: ${missing.join(", ")}`);
  console.error("   Run 'pnpm build' first to generate main.js");
  process.exit(1);
}

// Ensure dist directory exists
const distDir = join(rootDir, "dist");
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// ============================================================================
// ZIP generation using only Node.js built-ins
// Based on the ZIP file format specification
// ============================================================================

function crc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
}

const CRC_TABLE = crc32Table();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return ~c >>> 0;
}

function writeUInt32LE(buf, offset, value) {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

function writeUInt16LE(buf, offset, value) {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

function dateToDos(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = date.getHours();
  const minute = date.getMinutes();
  const second = date.getSeconds();
  return {
    time: (second >> 1) | (minute << 5) | (hour << 11),
    date: day | (month << 5) | ((year - 1980) << 9),
  };
}

function createLocalFileHeader(name, size, crc, date) {
  const nameBuf = Buffer.from(name, "utf-8");
  const header = Buffer.alloc(30 + nameBuf.length);
  const dos = dateToDos(date);

  header.write("PK\x03\x04", 0); // local file header signature
  writeUInt16LE(header, 4, 20); // version needed (2.0)
  writeUInt16LE(header, 6, 0); // general purpose bit flag
  writeUInt16LE(header, 8, 0); // compression method (stored)
  writeUInt16LE(header, 10, dos.time); // modification time
  writeUInt16LE(header, 12, dos.date); // modification date
  writeUInt32LE(header, 14, crc); // crc-32
  writeUInt32LE(header, 18, size); // compressed size
  writeUInt32LE(header, 22, size); // uncompressed size
  writeUInt16LE(header, 26, nameBuf.length); // file name length
  writeUInt16LE(header, 28, 0); // extra field length
  nameBuf.copy(header, 30);

  return header;
}

function createCentralDirectoryHeader(name, size, crc, offset, date) {
  const nameBuf = Buffer.from(name, "utf-8");
  const header = Buffer.alloc(46 + nameBuf.length);
  const dos = dateToDos(date);

  header.write("PK\x01\x02", 0); // central directory signature
  writeUInt16LE(header, 4, 20); // version made by
  writeUInt16LE(header, 6, 20); // version needed
  writeUInt16LE(header, 8, 0); // general purpose bit flag
  writeUInt16LE(header, 10, 0); // compression method
  writeUInt16LE(header, 12, dos.time); // modification time
  writeUInt16LE(header, 14, dos.date); // modification date
  writeUInt32LE(header, 16, crc); // crc-32
  writeUInt32LE(header, 20, size); // compressed size
  writeUInt32LE(header, 24, size); // uncompressed size
  writeUInt16LE(header, 28, nameBuf.length); // file name length
  writeUInt16LE(header, 30, 0); // extra field length
  writeUInt16LE(header, 32, 0); // file comment length
  writeUInt16LE(header, 34, 0); // disk number start
  writeUInt16LE(header, 36, 0); // internal file attributes
  writeUInt32LE(header, 38, 0); // external file attributes
  writeUInt32LE(header, 42, offset); // relative offset of local header
  nameBuf.copy(header, 46);

  return header;
}

function createEndOfCentralDirectory(centralDirSize, centralDirOffset, numEntries) {
  const eocd = Buffer.alloc(22);

  eocd.write("PK\x05\x06", 0); // end of central directory signature
  writeUInt16LE(eocd, 4, 0); // number of this disk
  writeUInt16LE(eocd, 6, 0); // disk with central directory
  writeUInt16LE(eocd, 8, numEntries); // number of entries on this disk
  writeUInt16LE(eocd, 10, numEntries); // total number of entries
  writeUInt32LE(eocd, 12, centralDirSize); // size of central directory
  writeUInt32LE(eocd, 16, centralDirOffset); // offset of start of central directory
  writeUInt16LE(eocd, 20, 0); // comment length

  return eocd;
}

// Build the ZIP file
const now = new Date();
const entries = [];
let currentOffset = 0;

for (const file of filesToInclude) {
  const filePath = join(rootDir, file);
  const content = readFileSync(filePath);
  const name = `${id}/${file}`;
  const crc = crc32(content);
  const size = content.length;

  const localHeader = createLocalFileHeader(name, size, crc, now);
  const centralHeader = createCentralDirectoryHeader(name, size, crc, currentOffset, now);

  entries.push({
    localHeader,
    content,
    centralHeader,
  });

  currentOffset += localHeader.length + content.length;
}

// Calculate central directory offset and size
const centralDirOffset = currentOffset;
let centralDirSize = 0;
for (const entry of entries) {
  centralDirSize += entry.centralHeader.length;
}

// Write the ZIP file
const output = createWriteStream(archivePath);

for (const entry of entries) {
  output.write(entry.localHeader);
  output.write(entry.content);
}

for (const entry of entries) {
  output.write(entry.centralHeader);
}

output.write(createEndOfCentralDirectory(centralDirSize, centralDirOffset, entries.length));
output.end();

output.on("finish", () => {
  const stats = statSync(archivePath);
  const sizeKB = (stats.size / 1024).toFixed(1);

  console.log(`✅ Archive created: dist/${archiveName} (${sizeKB} KB)`);
  console.log(`   Plugin ID: ${id}`);
  console.log(`   Version:   ${version}`);
  console.log(`   Files:     ${filesToInclude.join(", ")}`);
  console.log("");
  console.log("📦 Installation:");
  console.log(`   unzip ${archiveName} -d /path/to/vault/.obsidian/plugins/`);
});

output.on("error", (err) => {
  console.error("❌ Archive creation failed:", err.message);
  process.exit(1);
});
