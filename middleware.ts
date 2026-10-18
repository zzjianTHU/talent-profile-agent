// 访问码门禁：没有通行 cookie 的请求，页面跳到 /gate，接口返回 401
import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "hr_access";

export function middleware(req: NextRequest) {
  const code = process.env.ACCESS_CODE;
  if (!code) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/gate") || pathname.startsWith("/api/gate") || pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }
  if (req.cookies.get(COOKIE)?.value === code) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "需要访问码" }, { status: 401 });
  // 在 Cloudflare Tunnel 后面时，用外部域名拼跳转地址，而不是 localhost:端口
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return NextResponse.redirect(`${proto}://${host}/gate`);
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
