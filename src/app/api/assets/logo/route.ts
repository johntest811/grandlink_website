import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cachedPngBuffer: Buffer | null = null;

async function getLogoPngBuffer() {
  if (cachedPngBuffer) return cachedPngBuffer;

  const logoPath = path.join(process.cwd(), "public", "ge-logo.avif");
  const raw = await fs.readFile(logoPath);
  cachedPngBuffer = await sharp(raw).png().toBuffer();
  return cachedPngBuffer;
}

export async function GET() {
  try {
    const png = await getLogoPngBuffer();
    return new NextResponse(png, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    });
  } catch (error) {
    console.error("Failed to load invoice logo:", error);
    return NextResponse.json({ error: "Logo not found" }, { status: 404 });
  }
}
