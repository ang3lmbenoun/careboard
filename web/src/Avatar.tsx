// A friendly illustrated portrait drawn from the patient number alone. It never uses the patient's name,
// and nothing here is stored or sent anywhere: the database still hides every patient's real name.
export const SKIN: [string, string][] = [
  ["#f7dcc4", "#e8bd9c"],
  ["#f0c9a4", "#dca67c"],
  ["#d9a276", "#c0805a"],
  ["#b87d55", "#9c613f"],
  ["#8a5a3b", "#6f442b"],
  ["#fbe5d3", "#efc7a9"],
];
export const HAIR = ["#2a1b14", "#161616", "#4b2e1c", "#7a4a24", "#a8742f", "#d1ad63", "#5a2d22"];
export const GREY = "#9a9aa2";
export const IRIS = ["#4a3224", "#2f4a3b", "#5b7a8c", "#6b4a2b", "#3b3f55"];
export const TOP = ["#1f5c4a", "#b8903f", "#2a8f9a", "#6b5b95", "#c7684f", "#3d7ea6", "#2a7360", "#a45a7a"];
export const BG: [string, string][] = [
  ["#d7ece2", "#f0f8f3"],
  ["#f3e9cf", "#fcf8ec"],
  ["#d6ecef", "#f0f8f9"],
  ["#e6e0f2", "#f6f3fb"],
  ["#f6e0d8", "#fcf2ee"],
  ["#dbe8f3", "#f1f6fb"],
];

export function mix(seed: number) {
  let a = seed * 2654435761;
  return () => {
    a = (a ^ (a >>> 15)) * 2246822519;
    a = (a ^ (a >>> 13)) * 3266489917;
    a ^= a >>> 16;
    return (a >>> 0) / 4294967296;
  };
}

// Ordinary first names, chosen from the patient number in the browser. They are made up, not stored, and not
// anyone's real name. The portrait matches the name, so "Maya" is always drawn as a woman.
const FEMALE = [
  "Maya", "Priya", "Sofia", "Amara", "Elena", "Grace", "Naomi", "Leila", "Hannah", "Camila", "Aisha", "Chloe",
  "Nora", "Imani", "Mei", "Rosa", "Julia", "Zara", "Ingrid", "Tessa", "Daniela", "Keisha", "Alma", "Clara",
];
const MALE = [
  "Marcus", "Daniel", "Mateo", "Omar", "Ethan", "Isaiah", "Kenji", "Andre", "Lucas", "Samir", "Noah", "Miguel",
  "Theo", "Jamal", "Victor", "Owen", "Rafael", "Felix", "Hassan", "Dominic", "Caleb", "Arjun", "Leo", "Tobias",
];

export function who(id: number): { female: boolean; name: string } {
  const r = mix(id + 101);
  const female = r() < 0.5;
  const list = female ? FEMALE : MALE;
  return { female, name: list[Math.floor(r() * list.length)] };
}
export const nickname = (id: number) => who(id).name;

import { useEffect, useState, type ReactElement } from "react";
export type Cap = { back?: ReactElement; front: ReactElement };

export function femaleHair(style: number, c: string): Cap {
  const fringe = <path d="M21 27c-1-11 5-16 11.5-16S44 16 43 27c-1.5-5.5-5-9-10-10-4 3-9 5-12 10z" fill={c} />;
  switch (style) {
    case 0:
      return { back: <path d="M19.5 27C18 14 25 8.5 32 8.5S46 14 44.5 27L47 52H17z" fill={c} />, front: fringe };
    case 1:
      return {
        back: <path d="M19 28C16 15 24 8 32 8s16 7 13 20c2.5 8 0 14 3 24H16c3-10 .5-16 3-24z" fill={c} />,
        front: fringe,
      };
    case 2:
      return {
        back: <path d="M19.500 27C18 14 25 9 32 9s14 5 12.500 18l.500 12c-2 3-6 3-8 .500L28 39.500c-2 2.500-6 2.500-8.500-.500z" fill={c} />,
        front: <path d="M21 27c-1-11 5-16 11-16s12 5 11 16c-2-6-6-9.500-11-9.500S23 21 21 27z" fill={c} />,
      };
    case 3:
      return {
        back: <circle cx="32" cy="8.500" r="5.500" fill={c} />,
        front: <path d="M21 27c-1-10 5-15.500 11-15.500S44 17 43 27c-3-6-6.500-9-11-9s-8 3-11 9z" fill={c} />,
      };
    case 4:
      return {
        back: (
          <g fill={c}>
            <circle cx="19" cy="23" r="7" />
            <circle cx="24" cy="13.500" r="7.500" />
            <circle cx="32" cy="10.500" r="8" />
            <circle cx="40" cy="13.500" r="7.500" />
            <circle cx="45" cy="23" r="7" />
            <circle cx="20.500" cy="32" r="4.500" />
            <circle cx="43.500" cy="32" r="4.500" />
          </g>
        ),
        front: <path d="M22.500 25c1.500-4.500 5-7 9.500-7s8 2.500 9.500 7c-3-2-6-3-9.500-3s-6.500 1-9.500 3z" fill={c} />,
      };
    default:
      return {
        back: <path d="M44 22c8 0 8.500 9 5 17-1.500 3.500-5 4-6.500 1 2-6 2-11-.500-18z" fill={c} />,
        front: fringe,
      };
  }
}

export function maleHair(style: number, c: string): Cap {
  switch (style) {
    case 0:
      return { front: <path d="M20.500 27C19.500 15 25.500 11 32 11s12.500 4 11.500 16c-1.500-5-4.500-8-11.500-8s-10 3-11.500 8z" fill={c} /> };
    case 1:
      return {
        front: <path d="M20.500 27C19 14.500 26 10.500 33 10.500S45 15 43.500 27c-1-5.500-3.500-9-9-9.500C30 19.500 24 19.500 22 25z" fill={c} />,
      };
    case 2:
      return {
        back: (
          <g fill={c}>
            <circle cx="24" cy="15" r="5.500" />
            <circle cx="30" cy="12" r="6" />
            <circle cx="36.500" cy="12" r="6" />
            <circle cx="42" cy="16" r="5.500" />
            <circle cx="21" cy="21" r="4.500" />
            <circle cx="44" cy="22" r="4.500" />
          </g>
        ),
        front: <path d="M20.500 27c-.500-11 4.500-16 11.500-16s12 5 11.500 16c-3-3-6.500-4-11.500-4s-8.500 1-11.500 4z" fill={c} />,
      };
    case 3:
      return { front: <path d="M21 26c-1-10 5-13.500 11-13.500S44 16 43 26c-2-5-5-7-11-7s-9 2-11 7z" fill={c} opacity="0.85" /> };
    default:
      return {
        back: <path d="M19.500 27C18 14 25 9.500 32 9.500S46 14 44.500 27l.500 11c-2-2-3-4-3.500-7h-19c-.500 3-1.500 5-3.500 7z" fill={c} />,
        front: <path d="M21 27c-1-10 5-15 11.500-15S44 17 43 27c-1.500-5-4.500-8-10-9-4 3-9 5-12 9z" fill={c} />,
      };
  }
}

export type Traits = ReturnType<typeof traits>;

// Everything that makes one patient look like themselves, drawn from the patient number. Shared by the portrait and the full figure.
export function traits(id: number, age?: number) {
  const { female } = who(id);
  const r = mix(id + 7);
  const [skin, shade] = SKIN[Math.floor(r() * SKIN.length)];
  const baseHair = HAIR[Math.floor(r() * HAIR.length)];
  const greyDraw = r();
  // Hair greys with age, so a 30-year-old does not get silver hair. Without an age, nobody is grey.
  const hair = age !== undefined && greyDraw < (age >= 62 ? 0.75 : age >= 52 ? 0.3 : 0) ? GREY : baseHair;
  const iris = IRIS[Math.floor(r() * IRIS.length)];
  const top = TOP[Math.floor(r() * TOP.length)];
  const [b1, b2] = BG[Math.floor(r() * BG.length)];
  const style = Math.floor(r() * (female ? 6 : 5));
  const glasses = r() < 0.25;
  const beard = !female && r() < 0.3;
  const cap = female ? femaleHair(style, hair) : maleHair(style, hair);
  const lip = female ? "#c4566a" : "#a5483c";
  return { female, skin, shade, hair, iris, top, b1, b2, style, glasses, beard, cap, lip };
}

// The face and front hair, drawn in a 64-unit box. The portrait shows it as is; the full figure scales it up.
export function Head({ t, gid, waving, noCap }: { t: Traits; gid: string; waving: boolean; noCap?: boolean }) {
  const { female, shade, hair, iris, glasses, beard, cap, lip } = t;
  return (
    <>
      {!noCap && cap.back}
      <ellipse cx="20.800" cy="30" rx="1.800" ry="2.800" fill={shade} />
      <ellipse cx="43.200" cy="30" rx="1.800" ry="2.800" fill={shade} />
      <path d="M21 27C21 18 26 14 32 14s11 4 11 13c0 8.500-5 15.500-11 15.500S21 35.500 21 27z" fill={`url(#${gid}s)`} />
      {beard && <path d="M21.500 31C22 40 27 44.500 32 44.500S42 40 42.500 31C41 37 37 40 32 40s-9-3-10.500-9z" fill={hair} />}
      <path d="M23.200 25.300Q27 22.800 30.300 24.600M33.700 24.600Q37 22.800 40.800 25.300" fill="none" stroke={hair} strokeWidth="1.300" strokeLinecap="round" opacity="0.9" />
      {waving ? (
        <>
          <path d="M24.300 29.500q2.700-3.200 5.400 0M34.300 29.500q2.700-3.200 5.400 0" stroke="#2b2b2b" strokeWidth="1.500" fill="none" strokeLinecap="round" />
          <path d="M26.800 33.800c1.400 6.200 8.600 6.200 10.400 0z" fill="#fff" stroke={lip} strokeWidth="1.200" strokeLinejoin="round" />
        </>
      ) : (
        <>
          {[27, 37].map((x) => (
            <g key={x} className="av-eye">
              <ellipse cx={x} cy="29" rx="2.800" ry="2" fill="#fff" />
              <circle cx={x} cy="29" r="1.600" fill={iris} />
              <circle cx={x} cy="29" r="0.800" fill="#14110f" />
              <circle cx={x + 0.6} cy="28.300" r="0.500" fill="#fff" />
            </g>
          ))}
          <path d="M24 28.600Q27 26.200 30 28.600M34 28.600Q37 26.200 40 28.600" fill="none" stroke="#2b2b2b" strokeWidth={female ? 1.300 : 1} strokeLinecap="round" />
          {female && <path d="M23.800 28.800l-1-.9M40.200 28.800l1-.9" stroke="#2b2b2b" strokeWidth="1" strokeLinecap="round" />}
          <path d="M28.500 35.600Q32 38.300 35.500 35.600" fill={female ? lip : "none"} fillOpacity={female ? 0.18 : 0} stroke={lip} strokeWidth="1.300" strokeLinecap="round" />
        </>
      )}
      <path d="M31.200 31.800q.8 1.300 1.800.2" fill="none" stroke={shade} strokeWidth="1" strokeLinecap="round" />
      <circle cx="24.200" cy="34" r="2.600" fill="#f08a7a" opacity={waving ? 0.5 : 0.28} />
      <circle cx="39.800" cy="34" r="2.600" fill="#f08a7a" opacity={waving ? 0.5 : 0.28} />
      {glasses && (
        <g fill="none" stroke="#33413b" strokeWidth="1.100">
          <rect x="23" y="26.500" width="8" height="5.600" rx="2.600" />
          <rect x="33" y="26.500" width="8" height="5.600" rx="2.600" />
          <path d="M31 28.800h2" />
        </g>
      )}
      {cap.front}
      <path d="M25 15.500c3-2.200 7-2.700 10-1.300" fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="1.300" strokeLinecap="round" />
    </>
  );
}

type AvatarProps = { id: number; size?: number; waving?: boolean; age?: number };

// The drawn portrait. It is the fallback when an illustration file is missing.
function SvgAvatar({ id, size = 56, waving = false, age }: AvatarProps) {
  const t = traits(id, age);
  const { skin, shade, top, b1, b2 } = t;
  const gid = `av${id}`;

  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`Avatar for patient ${id}`} className={"avatar" + (waving ? " waving" : "")}>
      <defs>
        <linearGradient id={`${gid}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={b1} />
          <stop offset="1" stopColor={b2} />
        </linearGradient>
        <linearGradient id={`${gid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={skin} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
        <linearGradient id={`${gid}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={top} stopOpacity="0.82" />
        </linearGradient>
        <clipPath id={`${gid}c`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${gid}c)`}>
        <rect width="64" height="64" fill={`url(#${gid}b)`} />
        {t.cap.back}
        {/* shoulders and a V-neck top */}
        <path d="M5 68c0-13 10-20.500 21-22l6 8 6-8c11 1.500 21 9 21 22z" fill={`url(#${gid}t)`} />
        <path d="M26 46l6 8 6-8" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.100" strokeLinejoin="round" />
        {/* neck, with a soft shadow under the chin */}
        <path d="M27.500 38h9v8c0 3-2 6-4.500 6S27.500 49 27.500 46z" fill={`url(#${gid}s)`} />
        <path d="M27.500 41c1.500 2.500 7.500 2.500 9 0v-3h-9z" fill={shade} opacity="0.55" />
        <Head t={t} gid={gid} waving={waving} noCap />
        {waving && (
          <g className="av-hand">
            <rect x="45.500" y="43" width="7" height="17" rx="3.500" fill={`url(#${gid}t)`} />
            <circle cx="49" cy="39.500" r="4.300" fill={skin} />
            <ellipse cx="44.800" cy="40.500" rx="1.400" ry="2.400" transform="rotate(-25 44.800 40.500)" fill={skin} />
            <rect x="45.800" y="33.400" width="1.700" height="4.200" rx="0.850" fill={skin} />
            <rect x="48.100" y="32.600" width="1.700" height="4.600" rx="0.850" fill={skin} />
            <rect x="50.400" y="33.400" width="1.700" height="4.200" rx="0.850" fill={skin} />
          </g>
        )}
      </g>
    </svg>
  );
}

// Illustrated portraits live in public/avatars as female-01..06 and male-01..06, each with a neutral and a waving image.
// The patient number picks one, so the same patient always gets the same face. Nothing is sent anywhere.
const VARIANTS = 6;
const GREY_MAN = 5; // male-05 has grey hair, so he is used for older patients and kept away from younger ones

function pick(id: number, female: boolean, age?: number) {
  const r = mix(id + 701);
  let v = Math.floor(r() * VARIANTS) + 1;
  const older = r() < 0.6;
  if (!female) {
    if (age !== undefined && age >= 55 && older) v = GREY_MAN;
    else if (v === GREY_MAN && (age === undefined || age < 45)) v = 2;
  }
  return v;
}

export default function Avatar(props: AvatarProps) {
  const { id, size = 56, waving = false, age } = props;
  const [failed, setFailed] = useState(false);
  const { female, name } = who(id);
  const v = pick(id, female, age);
  const base = `/avatars/${female ? "female" : "male"}-0${v}`;

  // Load the waving picture ahead of the click so the swap is instant.
  useEffect(() => {
    new Image().src = `${base}-waving.webp`;
  }, [base]);

  if (failed) return <SvgAvatar {...props} />;
  return (
    <img
      className={"avatar" + (waving ? " waving" : "")}
      src={`${base}-${waving ? "waving" : "neutral"}.webp`}
      width={size}
      height={size}
      alt={`${name}, patient ${id}`}
      draggable={false}
      onError={() => setFailed(true)}
      style={{ objectFit: "cover", objectPosition: "center 18%", background: "#e9ecf6", borderRadius: "50%", display: "block", flex: "none", overflow: "hidden" }}
    />
  );
}
