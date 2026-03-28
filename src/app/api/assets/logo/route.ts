import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-static";

let cachedPng: Buffer | null = null;

async function getLogoPng() {
  if (cachedPng) return cachedPng;
  const logoPath = path.join(process.cwd(), "public", "ge-logo.avif");
  const raw = await fs.readFile(logoPath);
  cachedPng = await sharp(raw).png().toBuffer();
  return cachedPng;
}

export async function GET() {
  try {
    const png = await getLogoPng();
    return new Response(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Failed to serve logo PNG:", error);
    return Response.redirect("/ge-logo.avif", 307);
  }
}
