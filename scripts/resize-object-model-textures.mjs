import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

const MODEL_TEXTURE_TARGETS = new Map([
  ["Player_Core_Blue.glb", 1024],
  ["Player_Core_Green.glb", 1024],
  ["Player_Core_Red.glb", 1024],
  ["Player_Core_Yellow.glb", 1024],
  ["Tether_Anchor_Blue.glb", 1024],
  ["Tether_Anchor_Green.glb", 1024],
  ["Tether_Anchor_Red.glb", 1024],
  ["Tether_Anchor_Yellow.glb", 1024],
  ["Tether_Nugget.glb", 512],
]);

const assetDirectory = resolve("public/assets/game-objects");
const workDirectory = mkdtempSync(join(tmpdir(), "object-texture-resize-"));
const results = [];

try {
  for (const [fileName, targetSize] of MODEL_TEXTURE_TARGETS) {
    const filePath = join(assetDirectory, fileName);
    results.push(resizeGlbTextures(filePath, targetSize, workDirectory));
  }
} finally {
  rmSync(workDirectory, { recursive: true, force: true });
}

for (const result of results) {
  const dimensions = result.images.map(({ width, height }) => `${width}x${height}`).join(", ");
  console.log(
    `${result.fileName}: ${dimensions}; ${formatBytes(result.beforeBytes)} -> ${formatBytes(result.afterBytes)}`,
  );
}

function resizeGlbTextures(filePath, targetSize, tempRoot) {
  const originalBytes = readFileSync(filePath);
  const original = parseGlb(originalBytes, filePath);
  const originalJsonSnapshot = structuredClone(original.json);
  const originalViewHashes = hashBufferViews(original.json, original.bin);
  const imageViewIndices = new Set(
    original.json.images.map((image, imageIndex) => {
      if (image.uri !== undefined || image.bufferView === undefined) {
        throw new Error(`${basename(filePath)} image ${imageIndex} is not embedded in a buffer view.`);
      }
      if (image.mimeType !== "image/jpeg") {
        throw new Error(`${basename(filePath)} image ${imageIndex} is not a JPEG.`);
      }
      return image.bufferView;
    }),
  );

  const replacementByView = new Map();
  const imageDimensions = [];
  for (const viewIndex of imageViewIndices) {
    const view = original.json.bufferViews[viewIndex];
    if (!view || view.buffer !== 0) {
      throw new Error(`${basename(filePath)} image buffer view ${viewIndex} is invalid.`);
    }
    const sourceBytes = sliceBufferView(original.bin, view);
    const imageRoot = join(tempRoot, `${basename(filePath, ".glb")}-${viewIndex}`);
    const sourcePath = `${imageRoot}-source.jpg`;
    const resizedPath = `${imageRoot}-${targetSize}.jpg`;
    writeFileSync(sourcePath, sourceBytes);
    const sourceDimensions = inspectImage(sourcePath);
    let resizedBytes = sourceBytes;
    let dimensions = sourceDimensions;
    if (sourceDimensions.width !== targetSize || sourceDimensions.height !== targetSize) {
      execFileSync(
        "sips",
        [
          "-z",
          String(targetSize),
          String(targetSize),
          "-s",
          "format",
          "jpeg",
          "-s",
          "formatOptions",
          "high",
          sourcePath,
          "--out",
          resizedPath,
        ],
        { stdio: "ignore" },
      );
      resizedBytes = readFileSync(resizedPath);
      dimensions = inspectImage(resizedPath);
    }
    if (dimensions.width !== targetSize || dimensions.height !== targetSize) {
      throw new Error(
        `${basename(filePath)} image ${viewIndex} resized to ${dimensions.width}x${dimensions.height}, expected ${targetSize}x${targetSize}.`,
      );
    }
    replacementByView.set(viewIndex, resizedBytes);
    imageDimensions.push(dimensions);
  }

  const rebuiltBin = rebuildBin(original.json, original.bin, replacementByView);
  original.json.buffers[0].byteLength = rebuiltBin.length;
  const rebuiltBytes = buildGlb(original.json, rebuiltBin);
  const temporaryOutput = join(dirname(filePath), `.${basename(filePath)}.resized`);
  writeFileSync(temporaryOutput, rebuiltBytes);

  try {
    verifyGlb(
      temporaryOutput,
      targetSize,
      originalJsonSnapshot,
      originalViewHashes,
      imageViewIndices,
      tempRoot,
    );
    renameSync(temporaryOutput, filePath);
  } catch (error) {
    rmSync(temporaryOutput, { force: true });
    throw error;
  }

  return {
    fileName: basename(filePath),
    beforeBytes: originalBytes.length,
    afterBytes: statSync(filePath).size,
    images: imageDimensions,
  };
}

function parseGlb(bytes, filePath) {
  if (bytes.length < 20 || bytes.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error(`${basename(filePath)} is not a GLB file.`);
  }
  if (bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error(`${basename(filePath)} has an unsupported or invalid GLB header.`);
  }

  let cursor = 12;
  let json;
  let bin;
  while (cursor < bytes.length) {
    const chunkLength = bytes.readUInt32LE(cursor);
    const chunkType = bytes.readUInt32LE(cursor + 4);
    const chunk = bytes.subarray(cursor + 8, cursor + 8 + chunkLength);
    if (chunkType === JSON_CHUNK_TYPE) {
      json = JSON.parse(chunk.toString("utf8").replace(/[\u0000 ]+$/u, ""));
    } else if (chunkType === BIN_CHUNK_TYPE) {
      bin = chunk;
    }
    cursor += 8 + chunkLength;
  }
  if (!json || !bin || json.buffers?.length !== 1) {
    throw new Error(`${basename(filePath)} must contain one JSON chunk and one embedded buffer.`);
  }
  return { json, bin };
}

function rebuildBin(json, originalBin, replacementByView) {
  const chunks = [];
  let byteLength = 0;
  const orderedViews = json.bufferViews
    .map((view, index) => ({ view, index }))
    .sort((a, b) => (a.view.byteOffset ?? 0) - (b.view.byteOffset ?? 0));

  for (const { view, index } of orderedViews) {
    const padding = (4 - (byteLength % 4)) % 4;
    if (padding) {
      chunks.push(Buffer.alloc(padding));
      byteLength += padding;
    }
    const contents = replacementByView.get(index) ?? sliceBufferView(originalBin, view);
    view.byteOffset = byteLength;
    view.byteLength = contents.length;
    chunks.push(contents);
    byteLength += contents.length;
  }

  return Buffer.concat(chunks, byteLength);
}

function buildGlb(json, bin) {
  const unpaddedJson = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadding = (4 - (unpaddedJson.length % 4)) % 4;
  const jsonChunk = Buffer.concat([unpaddedJson, Buffer.alloc(jsonPadding, 0x20)]);
  const binPadding = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPadding)]);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const output = Buffer.allocUnsafe(totalLength);
  output.writeUInt32LE(GLB_MAGIC, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(jsonChunk.length, 12);
  output.writeUInt32LE(JSON_CHUNK_TYPE, 16);
  jsonChunk.copy(output, 20);
  const binHeaderOffset = 20 + jsonChunk.length;
  output.writeUInt32LE(binChunk.length, binHeaderOffset);
  output.writeUInt32LE(BIN_CHUNK_TYPE, binHeaderOffset + 4);
  binChunk.copy(output, binHeaderOffset + 8);
  return output;
}

function verifyGlb(
  filePath,
  targetSize,
  originalJson,
  originalViewHashes,
  imageViewIndices,
  tempRoot,
) {
  const rebuilt = parseGlb(readFileSync(filePath), filePath);
  const comparableOriginal = stripExpectedBinaryLayoutChanges(originalJson);
  const comparableRebuilt = stripExpectedBinaryLayoutChanges(rebuilt.json);
  if (JSON.stringify(comparableOriginal) !== JSON.stringify(comparableRebuilt)) {
    throw new Error(`${basename(filePath)} changed non-binary-layout GLB metadata.`);
  }

  const rebuiltHashes = hashBufferViews(rebuilt.json, rebuilt.bin);
  for (const [viewIndex, originalHash] of originalViewHashes) {
    if (imageViewIndices.has(viewIndex)) continue;
    const originalView = originalJson.bufferViews[viewIndex];
    const rebuiltView = rebuilt.json.bufferViews[viewIndex];
    if (
      originalView.byteOffset !== rebuiltView.byteOffset
      || originalView.byteLength !== rebuiltView.byteLength
    ) {
      throw new Error(`${basename(filePath)} moved non-texture buffer view ${viewIndex}.`);
    }
    if (rebuiltHashes.get(viewIndex) !== originalHash) {
      throw new Error(`${basename(filePath)} changed non-texture buffer view ${viewIndex}.`);
    }
  }

  rebuilt.json.images.forEach((image, imageIndex) => {
    const view = rebuilt.json.bufferViews[image.bufferView];
    const imagePath = join(tempRoot, `verify-${basename(filePath)}-${imageIndex}.jpg`);
    writeFileSync(imagePath, sliceBufferView(rebuilt.bin, view));
    const { width, height } = inspectImage(imagePath);
    if (width !== targetSize || height !== targetSize) {
      throw new Error(
        `${basename(filePath)} image ${imageIndex} is ${width}x${height}, expected ${targetSize}x${targetSize}.`,
      );
    }
  });
}

function stripExpectedBinaryLayoutChanges(json) {
  const copy = structuredClone(json);
  for (const buffer of copy.buffers ?? []) delete buffer.byteLength;
  for (const view of copy.bufferViews ?? []) {
    delete view.byteOffset;
    delete view.byteLength;
  }
  return copy;
}

function hashBufferViews(json, bin) {
  return new Map(
    json.bufferViews.map((view, index) => [
      index,
      createHash("sha256").update(sliceBufferView(bin, view)).digest("hex"),
    ]),
  );
}

function sliceBufferView(bin, view) {
  const start = view.byteOffset ?? 0;
  return bin.subarray(start, start + view.byteLength);
}

function inspectImage(filePath) {
  const output = execFileSync(
    "sips",
    ["-g", "pixelWidth", "-g", "pixelHeight", filePath],
    { encoding: "utf8" },
  );
  const width = Number(output.match(/pixelWidth:\s*(\d+)/u)?.[1]);
  const height = Number(output.match(/pixelHeight:\s*(\d+)/u)?.[1]);
  if (!width || !height) throw new Error(`Could not inspect ${filePath}.`);
  return { width, height };
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
