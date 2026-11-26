import { useId } from "react";

/* CareBoard mark: a deep-green tile, a cream cross, and one gold data point. */
export default function Logo({ size = 24 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="cb-logo" viewBox="0 0 32 32" width={size} height={size} role="img" aria-label="CareBoard">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f7d66" />
          <stop offset="1" stopColor="#12352b" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path d="M16 8.5v11M10.5 14h11" stroke="#f6f2e6" strokeWidth="3.2" strokeLinecap="round" fill="none" />
      <circle cx="22.5" cy="22.5" r="2.7" fill="#d4af4f" />
    </svg>
  );
}
