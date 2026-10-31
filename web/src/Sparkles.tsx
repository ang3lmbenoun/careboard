import { useEffect, useRef } from "react";

type Spark = { x: number; y: number; r: number; vy: number; sway: number; phase: number; speed: number; rgb: string; a: number };

const COLORS = ["255,255,255", "255,255,255", "255,255,255", "240,205,130", "150,225,200"];

// Tiny glowing specks that fall like fine rain behind the sign-in page.
export default function Sparkles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let sparks: Spark[] = [];
    let raf = 0;
    let last = performance.now();

    const make = (above: boolean): Spark => {
      const r = 0.7 + Math.pow(Math.random(), 2.4) * 2.4;
      return {
        x: Math.random() * w,
        y: above ? -10 - Math.random() * h * 0.15 : Math.random() * h,
        r,
        vy: 22 + r * 16 + Math.random() * 30,
        sway: 2 + Math.random() * 9,
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 1.2,
        rgb: COLORS[Math.floor(Math.random() * COLORS.length)],
        a: 0.45 + Math.random() * 0.55,
      };
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(46, Math.min(150, Math.round((w * h) / 9000)));
      sparks = Array.from({ length: count }, () => make(false));
    };

    const draw = (s: Spark, t: number) => {
      const x = s.x + Math.sin(t * s.speed + s.phase) * s.sway;
      const tw = 0.65 + 0.35 * Math.sin(t * 2.2 + s.phase * 3);
      const a = s.a * tw;
      // faint trail, like a falling drop of light
      const trail = ctx.createLinearGradient(x, s.y - s.vy * 0.45, x, s.y);
      trail.addColorStop(0, `rgba(${s.rgb},0)`);
      trail.addColorStop(1, `rgba(${s.rgb},${0.22 * a})`);
      ctx.strokeStyle = trail;
      ctx.lineWidth = Math.max(0.6, s.r * 0.7);
      ctx.beginPath();
      ctx.moveTo(x, s.y - s.vy * 0.45);
      ctx.lineTo(x, s.y);
      ctx.stroke();
      if (s.r > 1.5) {
        const g = ctx.createRadialGradient(x, s.y, 0, x, s.y, s.r * 5);
        g.addColorStop(0, `rgba(${s.rgb},${0.32 * a})`);
        g.addColorStop(1, `rgba(${s.rgb},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, s.y, s.r * 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = `rgba(${s.rgb},${a})`;
      ctx.beginPath();
      ctx.arc(x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = now / 1000;
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < sparks.length; i++) {
        sparks[i].y += sparks[i].vy * dt;
        if (sparks[i].y > h + 12) sparks[i] = make(true);
        draw(sparks[i], t);
      }
      raf = requestAnimationFrame(frame);
    };

    resize();
    window.addEventListener("resize", resize);
    if (reduce) sparks.forEach((s) => draw(s, 0));
    else raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="sparkles" aria-hidden="true" />;
}
