import { extractJd } from "@/lib/vision";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { image } = (await req.json()) as { image?: string };
  if (!image?.startsWith("data:image/")) return Response.json({ error: "请上传图片" }, { status: 400 });
  if (image.length > 8_000_000) return Response.json({ error: "图片太大，请压缩后再试" }, { status: 413 });
  try {
    return Response.json(await extractJd(image));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
