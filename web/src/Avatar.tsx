// A friendly cartoon face drawn from the patient number alone. It never uses the patient's name.
const SKIN = ["#f3d2b3", "#e6b891", "#c98f62", "#a06c46", "#7a4f33", "#f6dcc4"];
const HAIR = ["#2b1d14", "#4a2f1c", "#8a5a2b", "#c9a15a", "#9a9a9a", "#171717"];
const SHIRT = ["#1f5c4a", "#b8903f", "#2a8f9a", "#6b5b95", "#c7684f", "#3d7ea6"];
const BG = [
  ["#d7ece2", "#eef6f1"],
  ["#f3e9cf", "#fbf6e8"],
  ["#d6ecef", "#eef7f8"],
  ["#e6e0f2", "#f4f1fa"],
  ["#f6e0d8", "#fbf0ec"],
  ["#dbe8f3", "#eff5fa"],
];

function mix(seed: number) {
  let a = seed * 2654435761;
  return () => {
    a = (a ^ (a >>> 15)) * 2246822519;
    a = (a ^ (a >>> 13)) * 3266489917;
    a ^= a >>> 16;
    return (a >>> 0) / 4294967296;
  };
}

export default function Avatar({ id, size = 56 }: { id: number; size?: number }) {
  const r = mix(id + 7);
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const shirt = SHIRT[Math.floor(r() * SHIRT.length)];
  const [b1, b2] = BG[Math.floor(r() * BG.length)];
  const style = Math.floor(r() * 5);
  const glasses = r() < 0.3;
  const gid = `av${id}`;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`Avatar for patient ${id}`} className="avatar">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={b1} />
          <stop offset="1" stopColor={b2} />
        </linearGradient>
        <clipPath id={`${gid}c`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${gid}c)`}>
        <rect width="64" height="64" fill={`url(#${gid})`} />
        {style === 1 && <rect x="16" y="20" width="32" height="34" rx="14" fill={hair} />}
        <path d="M8 68c0-14 10-20 24-20s24 6 24 20z" fill={shirt} />
        <rect x="27" y="40" width="10" height="10" rx="4" fill={skin} />
        <circle cx="32" cy="29" r="12.5" fill={skin} />
        {style === 0 && <path d="M19 28c0-11 7-16 13-16s13 5 13 16c-3-5-8-8-13-8s-10 3-13 8z" fill={hair} />}
        {style === 1 && <path d="M19 29c0-11 6-16 13-16s13 5 13 16c-4-6-8-9-13-9s-9 3-13 9z" fill={hair} />}
        {style === 2 && (
          <g fill={hair}>
            <circle cx="21" cy="21" r="6" />
            <circle cx="28" cy="16" r="6.5" />
            <circle cx="36" cy="16" r="6.5" />
            <circle cx="43" cy="21" r="6" />
          </g>
        )}
        {style === 4 && (
          <g fill={hair}>
            <circle cx="32" cy="12" r="5" />
            <path d="M19 28c0-10 6-14 13-14s13 4 13 14c-3-5-8-7-13-7s-10 2-13 7z" />
          </g>
        )}
        <circle cx="27.5" cy="29" r="1.5" fill="#2b2b2b" />
        <circle cx="36.5" cy="29" r="1.5" fill="#2b2b2b" />
        <path d="M27.5 34.5c1.2 1.6 7.8 1.6 9 0" stroke="#7a3b2e" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        {glasses && (
          <g fill="none" stroke="#33413b" strokeWidth="1.2">
            <circle cx="27.5" cy="29" r="4.2" />
            <circle cx="36.5" cy="29" r="4.2" />
            <path d="M31.7 29h0.6" />
          </g>
        )}
      </g>
    </svg>
  );
}
