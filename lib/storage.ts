import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Product image storage (plan §1): a local uploads/ folder in development, an
// S3-compatible bucket (Cloudflare R2, MinIO) in production, behind one interface.

export type Storage = {
  kind: "local" | "s3";
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  /** Local driver only (served by /api/uploads); S3 objects are fetched from the bucket URL. */
  get(key: string): Promise<{ body: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
  /** URL a browser can load the image from. */
  url(key: string): Promise<string>;
};

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;
type Ext = keyof typeof TYPES;

/** Detect the image type from its first bytes (never trust the file name or browser type). SVG is refused. */
export function sniffImage(b: Uint8Array): { contentType: string; ext: Ext } | null {
  const at = (i: number, bytes: number[]) => bytes.every((x, j) => b[i + j] === x);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { contentType: TYPES.png, ext: "png" };
  if (at(0, [0xff, 0xd8, 0xff])) return { contentType: TYPES.jpg, ext: "jpg" };
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return { contentType: TYPES.webp, ext: "webp" };
  return null;
}

/** Keys we generate: lowercase path segments, no dot-segments, an image extension. */
export function isSafeKey(key: string): boolean {
  return /^[a-z0-9_-]+(\/[a-z0-9_-]+)*\.(png|jpg|webp)$/.test(key);
}

function assertKey(key: string) {
  if (!isSafeKey(key)) throw new Error(`Invalid storage key: ${key}`);
}

const typeOf = (key: string) => TYPES[key.slice(key.lastIndexOf(".") + 1) as Ext] ?? "application/octet-stream";

export function localDriver(dir: string): Storage {
  const root = resolve(dir);
  const path = (key: string) => {
    assertKey(key);
    return join(root, key);
  };
  return {
    kind: "local",
    async put(key, body) {
      const p = path(key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, body);
    },
    async get(key) {
      try {
        return { body: new Uint8Array(await readFile(path(key))), contentType: typeOf(key) };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },
    async delete(key) {
      await rm(path(key), { force: true });
    },
    async url(key) {
      assertKey(key);
      return `/api/uploads/${key}`;
    },
  };
}

export function s3Driver(opts: { client: S3Client; bucket: string; publicBaseUrl?: string | null }): Storage {
  const { client, bucket } = opts;
  const base = opts.publicBaseUrl?.replace(/\/+$/, "");
  return {
    kind: "s3",
    async put(key, body, contentType) {
      assertKey(key);
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
    },
    async get() {
      return null;
    },
    async delete(key) {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async url(key) {
      assertKey(key);
      // Public bucket URL (R2 custom domain) when configured, otherwise a 1-hour presigned link.
      if (base) return `${base}/${key}`;
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 3600 });
    },
  };
}

export function storageFromEnv(env: Record<string, string | undefined>): Storage {
  if ((env.STORAGE_DRIVER ?? "local") === "local") return localDriver(env.STORAGE_LOCAL_DIR || "uploads");
  if (env.STORAGE_DRIVER !== "s3") throw new Error(`Unknown STORAGE_DRIVER "${env.STORAGE_DRIVER}" (use local or s3).`);
  for (const k of ["S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const) {
    if (!env[k]) throw new Error(`${k} is required when STORAGE_DRIVER=s3.`);
  }
  const client = new S3Client({
    region: env.S3_REGION || "auto",
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });
  return s3Driver({ client, bucket: env.S3_BUCKET!, publicBaseUrl: env.S3_PUBLIC_URL });
}

let cached: Storage | null = null;
/** The app's storage, configured from environment variables. */
export function getStorage(): Storage {
  return (cached ??= storageFromEnv(process.env));
}
