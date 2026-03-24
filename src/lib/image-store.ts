import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type StoredImageAsset = {
  key: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
};

const DEFAULT_STORAGE_ROOT = path.join(process.cwd(), "..", "scripts", "uploads");

function sanitizeBaseName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function normalizeKey(key: string) {
  return key.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function getImageStorageRoot() {
  return path.resolve(process.env.BLOG_MVP_IMAGE_STORAGE_DIR || DEFAULT_STORAGE_ROOT);
}

export function resolveStoredImagePath(key: string) {
  const normalized = normalizeKey(key);
  if (!normalized || normalized.includes("..")) {
    throw new Error("invalid image key");
  }

  const root = getImageStorageRoot();
  const resolved = path.resolve(root, normalized);
  const rootWithSep = `${root}${path.sep}`;

  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new Error("image key escapes storage root");
  }

  return resolved;
}

export function storedImageExists(key: string) {
  try {
    return fs.existsSync(resolveStoredImagePath(key));
  } catch {
    return false;
  }
}

function inferExtension(originalName: string, mimeType: string) {
  const fromName = path.extname(originalName).trim();
  if (fromName) return fromName;

  const mimeMap: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heif",
  };

  return mimeMap[mimeType] || ".bin";
}

export async function persistImageUploads(files: File[]) {
  const root = getImageStorageRoot();
  const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  const targetDir = path.join(root, datePrefix);
  await fsp.mkdir(targetDir, { recursive: true });

  const persisted = await Promise.all(
    files.map(async (file) => {
      const ext = inferExtension(file.name, file.type);
      const base = sanitizeBaseName(path.basename(file.name, path.extname(file.name))) || "image";
      const key = `${datePrefix}/${crypto.randomUUID()}-${base}${ext}`;
      const fullPath = resolveStoredImagePath(key);
      const buffer = Buffer.from(await file.arrayBuffer());

      await fsp.writeFile(fullPath, buffer);

      return {
        key,
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        size: buffer.byteLength,
        createdAt: new Date().toISOString(),
      } satisfies StoredImageAsset;
    }),
  );

  return persisted;
}

export async function readStoredImageBuffer(asset: Pick<StoredImageAsset, "key">) {
  return await fsp.readFile(resolveStoredImagePath(asset.key));
}
