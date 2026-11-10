import { getStorage, isSafeKey } from "@/lib/storage";

// Serves product images stored by the local storage driver (development and
// single-server installs). With STORAGE_DRIVER=s3 images come from the bucket.
export async function GET(_req: Request, { params }: RouteContext<"/api/uploads/[...key]">) {
  const key = (await params).key.join("/");
  const storage = getStorage();
  if (storage.kind !== "local" || !isSafeKey(key)) return new Response("Not found", { status: 404 });
  const file = await storage.get(key);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(file.body), {
    headers: {
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
