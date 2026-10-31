import type { ReactNode } from "react";

export const money = (v: number) => {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : `${Math.round(a)}`;
  return `${v < 0 ? "-" : ""}$${s}`;
};
export const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
export const pp = (v: number) => `${v >= 0 ? "+" : "-"}${Math.abs(v * 100).toFixed(1)} pts`;
export const num = (v: number) => Math.round(v).toLocaleString();
export const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export type Tone = "ok" | "info" | "warn" | "fail" | "muted" | "low" | "med" | "high" | "crit";

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

export const bandTone = (band: string): Tone =>
  band === "Critical" ? "crit" : band === "High" ? "high" : band === "Medium" ? "med" : "low";

export function Section({ title, lede, children }: { title: string; lede?: string; children: ReactNode }) {
  return (
    <section className="rsec">
      <h2 className="sec">{title}</h2>
      {lede && <p className="note rsec-lede">{lede}</p>}
      {children}
    </section>
  );
}

export function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "warn" | "ok" }) {
  return (
    <div className={"sc" + (tone ? ` sc-${tone}` : "")}>
      <p className="sc-label">{label}</p>
      <p className="sc-value">{value}</p>
      {note && <p className="sc-note">{note}</p>}
    </div>
  );
}

export function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  hint?: string;
}) {
  return (
    <label className="slider">
      <span className="slider-top">
        <span>{props.label}</span>
        <strong>{props.format(props.value)}</strong>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
      {props.hint && <span className="slider-hint">{props.hint}</span>}
    </label>
  );
}
