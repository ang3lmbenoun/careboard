import { useEffect, useRef, useState } from "react";

export type Pose = "calm" | "thinking" | "speaking";
const BASE = "/characters/";

/** Carey: the small assistant avatar. The AI tag stays on so nobody mistakes her for a person. */
export function Carey({ size = 28, wave = false, tag = true }: { size?: number; wave?: boolean; tag?: boolean }) {
  return (
    <span className={"cr-who" + (wave ? " wave" : "")} style={{ width: size, height: size }}>
      <img className="cr-av" style={{ width: size, height: size }} src={BASE + "carey.webp"} alt="Carey, the CareBoard assistant" />
      {tag && <span className="cr-tag">AI</span>}
    </span>
  );
}

/** Tiffany as a small round avatar. */
export function TiffanyAvatar({ size = 28, pose }: { size?: number; pose?: Pose }) {
  const cls = pose === "thinking" ? " think" : pose === "speaking" ? " talk" : "";
  return (
    <span className={"cr-who" + cls} style={{ width: size, height: size }}>
      <img className="cr-av" style={{ width: size, height: size }} src={BASE + "tiffany.webp"} alt="Tiffany, the CareBoard AI agent" />
    </span>
  );
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Tiffany's portrait. Calm loops quietly and now and then plays the second idle clip.
 * Thinking plays once and holds its last frame. Speaking loops while she answers.
 * With reduced motion, or if a clip fails to load, the still poster is shown.
 */
export function TiffanyStage({ pose }: { pose: Pose }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [idle, setIdle] = useState<"calm" | "extra">("calm");
  const [failed, setFailed] = useState(false);
  const still = failed || reduced();
  const clip = pose === "calm" ? idle : pose;

  // Every so often, play the second idle clip once, then go back to the loop.
  useEffect(() => {
    if (pose !== "calm" || still) return;
    const t = window.setInterval(() => setIdle("extra"), 18000);
    return () => window.clearInterval(t);
  }, [pose, still]);
  useEffect(() => { if (pose !== "calm") setIdle("calm"); }, [pose]);

  useEffect(() => {
    const v = ref.current;
    if (!v || still) return;
    v.load();
    v.play().catch(() => {});
  }, [clip, still]);

  return (
    <div className={"cr-portrait " + (pose === "calm" ? "calm" : pose === "thinking" ? "think" : "talk")}>
      <span className="cr-badge">
        {pose === "speaking" && <span className="cr-bars" aria-hidden="true"><span /><span /><span /><span /></span>}
        {pose === "thinking" ? "Thinking" : pose === "speaking" ? "Speaking" : "Ready"}
      </span>
      {still ? (
        <img src={BASE + "tiffany/poster.webp"} alt="Tiffany, the CareBoard AI agent" />
      ) : (
        <video
          ref={ref}
          key={clip}
          src={`${BASE}tiffany/${clip}.mp4`}
          poster={BASE + "tiffany/poster.webp"}
          muted playsInline preload="auto"
          loop={clip === "calm" || clip === "speaking"}
          onEnded={() => { if (clip === "extra") setIdle("calm"); }}
          onError={() => setFailed(true)}
          aria-label="Tiffany, the CareBoard AI agent"
        />
      )}
    </div>
  );
}
