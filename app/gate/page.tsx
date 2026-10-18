"use client";

import { useState } from "react";

export default function Gate() {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/gate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim() }) });
    setBusy(false);
    if (res.ok) location.href = "/";
    else setErr("访问码不对，再试一次");
  }

  return (
    <main className="flex h-screen items-center justify-center px-6">
      <form onSubmit={submit} className="glass-strong w-full max-w-[380px] rounded-[30px] p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[conic-gradient(from_200deg,#5ac8fa,#0071e3,#af52de,#5ac8fa)] text-[16px] font-bold text-white">画</div>
        <h1 className="mt-4 text-[22px] font-semibold tracking-tight text-ink">人才画像澄清 Agent</h1>
        <p className="mt-1 text-[13px] text-ink-3">演示版 · 请输入访问码</p>
        <input
          autoFocus
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="访问码"
          className="mt-6 w-full rounded-full bg-white/70 px-5 py-3 text-center text-[16px] tracking-[0.3em] outline-none ring-1 ring-black/10 focus:ring-2 focus:ring-accent/40"
        />
        {err && <div className="mt-2 text-[12px] text-bad">{err}</div>}
        <button disabled={!code.trim() || busy} className="btn-primary mt-4 w-full rounded-full py-3 text-[15px] font-semibold">
          {busy ? "验证中…" : "进入"}
        </button>
      </form>
    </main>
  );
}
