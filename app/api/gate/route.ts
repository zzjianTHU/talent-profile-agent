export async function POST(req: Request) {
  const { code } = (await req.json().catch(() => ({}))) as { code?: string };
  if (!process.env.ACCESS_CODE || code !== process.env.ACCESS_CODE) {
    return Response.json({ ok: false, error: "访问码不对" }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  res.headers.set("Set-Cookie", `hr_access=${encodeURIComponent(code)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; SameSite=Lax${req.url.startsWith("https") || req.headers.get("x-forwarded-proto") === "https" ? "; Secure" : ""}`);
  return res;
}
