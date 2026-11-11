import { useSyncExternalStore } from "react";

// How the app looks for one person: light or dark, and which font. Stored in this browser only.
export type Theme = "light" | "dark" | "system";
export type FontKey = "geist" | "inter" | "manrope" | "dmsans" | "jakarta" | "outfit";
export type Appearance = { theme: Theme; font: FontKey };

export const FONTS: { key: FontKey; label: string }[] = [
  { key: "geist", label: "Geist" },
  { key: "inter", label: "Inter" },
  { key: "manrope", label: "Manrope" },
  { key: "dmsans", label: "DM Sans" },
  { key: "jakarta", label: "Plus Jakarta Sans" },
  { key: "outfit", label: "Outfit" },
];

const KEY = "careboard.appearance";
const DEFAULT: Appearance = { theme: "system", font: "geist" };

export function loadAppearance(): Appearance {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || "{}");
    return {
      theme: ["light", "dark", "system"].includes(a.theme) ? a.theme : DEFAULT.theme,
      font: FONTS.some((f) => f.key === a.font) ? a.font : DEFAULT.font,
    };
  } catch {
    return DEFAULT;
  }
}

export const resolvedTheme = (t: Theme): "light" | "dark" =>
  t === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : t;

export function applyAppearance(a: Appearance = loadAppearance()) {
  const el = document.documentElement;
  el.dataset.theme = resolvedTheme(a.theme);
  el.dataset.font = a.font;
}

const listeners = new Set<() => void>();
let current: Appearance | null = null;

export function saveAppearance(a: Appearance) {
  current = a;
  listeners.forEach((l) => l());
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* private mode: the choice lasts until the page closes */
  }
  applyAppearance(a);
}

// Follow the device when the person chose "system".
export function watchSystemTheme() {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const on = () => { if (loadAppearance().theme === "system") applyAppearance(); };
  mq.addEventListener("change", on);
  return () => mq.removeEventListener("change", on);
}

// Lets the top bar and the Settings page stay in step.
export function useAppearance(): [Appearance, (patch: Partial<Appearance>) => void] {
  const a = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => (current ??= loadAppearance())
  );
  return [a, (patch) => saveAppearance({ ...a, ...patch })];
}
