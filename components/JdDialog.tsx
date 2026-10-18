"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

export interface JdOcr { text: string; model: string; ms: number; risks: string[] }

// 压缩到长边 1600px 的 JPEG，再交给识别 Agent
export async function recognizeJd(file: File): Promise<JdOcr & { preview: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.88));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("图片无法读取"));
    img.src = URL.createObjectURL(file);
  });
  const res = await fetch("/api/jd-image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error || "识别失败");
  return { ...j, preview: dataUrl };
}

// 对话中途补传 / 替换 JD：粘贴文字，或上传 / 拖入 / ⌘V 截图
export function JdDialog({ open, replacing, onClose, onSubmit }: {
  open: boolean;
  replacing: boolean;
  onClose: () => void;
  onSubmit: (text: string, fromShot: boolean) => void;
}) {
  const [text, setText] = useState("");
  const [shot, setShot] = useState<string | null>(null);
  const [ocr, setOcr] = useState<{ state: "idle" | "busy" | "done" | "error"; model?: string; ms?: number; risks?: string[]; error?: string }>({ state: "idle" });
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function recognize(file: File) {
    if (!file.type.startsWith("image/")) return;
    setOcr({ state: "busy" });
    try {
      const r = await recognizeJd(file);
      setShot(r.preview);
      setText(r.text);
      setOcr({ state: "done", model: r.model, ms: r.ms, risks: r.risks });
    } catch (e) {
      setOcr({ state: "error", error: e instanceof Error ? e.message : String(e) });
    }
  }

  useEffect(() => {
    if (!open) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) {
        e.preventDefault();
        recognize(f);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("paste", onPaste);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("keydown", onKey);
    };
  });

  if (!open) return null;
  const submit = () => {
    if (!text.trim()) return;
    onSubmit(text.trim(), ocr.state === "done");
    setText("");
    setShot(null);
    setOcr({ state: "idle" });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/15 px-6 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) recognize(f); }}
        className={cx("glass-strong rise w-full max-w-[640px] rounded-[30px] p-6", dragging && "ring-2 ring-accent/50")}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight text-ink">{replacing ? "替换岗位 JD" : "提供岗位 JD"}</h2>
            <p className="mt-1 text-[13px] text-ink-3">JD 是这次要校准的对象。粘贴文字，或把截图拖进来 / ⌘V 粘贴，识别 Agent 会自动转成文字。</p>
          </div>
          <button onClick={onClose} className="rounded-full px-2 text-[18px] text-ink-3 hover:text-ink" aria-label="关闭">×</button>
        </div>

        <div className="mt-4 flex items-center gap-2 text-[12px]">
          {ocr.state === "busy" && <span className="flex items-center gap-1.5 text-[#5856d6]"><span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#5856d6]" />识别 Agent 正在读取截图…</span>}
          {ocr.state === "done" && <span className="text-good">✓ 已从截图识别 · {ocr.model} · {((ocr.ms ?? 0) / 1000).toFixed(1)}s · 可直接修改</span>}
          {ocr.state === "error" && <span className="text-bad">{ocr.error}</span>}
          <button onClick={async () => { const b = await (await fetch("/samples/jd-sample.png")).blob(); recognize(new File([b], "jd-sample.png", { type: "image/png" })); }} className="ml-auto rounded-full glass-tint px-3 py-1 text-ink-2 hover:text-ink">用示例截图</button>
          <button onClick={() => fileRef.current?.click()} className="rounded-full glass-tint px-3 py-1 text-ink-2 hover:text-ink">📷 上传截图</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) recognize(f); e.target.value = ""; }} />
        </div>
        {ocr.state === "done" && !!ocr.risks?.length && (
          <div className="mt-2 rounded-xl bg-[#ff3b30]/8 px-3 py-2 text-[12px] text-bad">⚠️ 识别到可能违规的条款：{ocr.risks.join("；")}　— Agent 会在澄清时处理</div>
        )}
        <div className="mt-3 flex gap-3 rounded-[20px] bg-white/60 p-3 ring-1 ring-black/5">
          {shot && <img src={shot} alt="JD 截图" className="h-44 w-28 shrink-0 rounded-xl object-cover object-top ring-1 ring-black/10" />}
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={9} disabled={ocr.state === "busy"}
            placeholder={"【岗位职责】\n1. …\n\n【任职要求】\n1. …"}
            className="flex-1 resize-none bg-transparent text-[13px] leading-relaxed text-ink-2 outline-none placeholder:text-ink-4" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[12px] text-ink-3">{replacing ? "替换后，Agent 会按新 JD 重新对照冲突并重算回测" : "没有 JD 也没关系，Agent 会先用公司模板 JD"}</span>
          <button onClick={submit} disabled={!text.trim() || ocr.state === "busy"} className="btn-primary ml-auto rounded-full px-5 py-2 text-[13px] font-medium">
            {replacing ? "替换并重新对照" : "发送 JD"}
          </button>
        </div>
      </div>
    </div>
  );
}
