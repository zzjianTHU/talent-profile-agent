import type { DimLevel, DimStatus } from "@/lib/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

const STATUS_STYLE: Record<DimStatus, string> = {
  冲突: "bg-[#ff3b30]/10 text-bad",
  含糊: "bg-[#ff9f0a]/14 text-warn",
  明确: "bg-[#34c759]/12 text-good",
  已澄清: "bg-[#34c759]/12 text-good",
  待面试验证: "bg-accent/10 text-accent",
};

const LEVEL_STYLE: Record<DimLevel, string> = {
  硬性: "bg-ink text-white",
  加分: "bg-accent/10 text-accent",
  否决: "bg-[#ff3b30] text-white",
  不考察: "glass-tint text-ink-3 line-through",
  待定: "glass-tint text-ink-3",
};

export function StatusChip({ status }: { status: DimStatus }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>{status}</span>;
}

export function LevelChip({ level }: { level: DimLevel }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", LEVEL_STYLE[level])}>{level}</span>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" width="13" height="13">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".18" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Bar({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "muted" }) {
  const w = max ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-[rgba(120,120,128,.14)]">
      <div
        className={cx("h-1.5 rounded-full transition-all duration-700", tone === "accent" ? "bg-gradient-to-r from-[#5ac8fa] to-accent" : "bg-ink-4")}
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

export function Pill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center rounded-full glass-tint px-2 py-0.5 text-[11px] text-ink-2", className)}>{children}</span>;
}
