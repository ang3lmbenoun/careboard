import { useEffect, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError, del, post } from "./api";
import Avatar, { nickname } from "./Avatar";
import { clsKey } from "./Drugs";
import { useData } from "./useData";

type Payer = "Medicaid" | "Medicare" | "Dual" | "Commercial";
type Go = (t: "drugs" | "payers") => void;
const PAYERS: Payer[] = ["Medicare", "Medicaid", "Dual", "Commercial"];
const PAYER_NOTE: Record<Payer, string> = {
  Medicare: "Federal program, mainly for people 65 and over",
  Medicaid: "Joint federal and state program for people with low income",
  Dual: "Has both Medicare and Medicaid",
  Commercial: "Employer or private insurance",
};
function PayerTag({ payer }: { payer: Payer }) {
  return <span className={"payer payer-" + payer.toLowerCase()} title={PAYER_NOTE[payer]}>{payer}</span>;
}

type Row = {
  patient_id: number;
  clinic_id: number;
  birth_year: number;
  city: string;
  primary_condition: string;
  diagnosed_on: string | null;
  demo_created: boolean;
  by_nurse?: boolean | null;
  payer: Payer;
  current_classes: string[];
};
type Med = { med_id: number; drug: string; drug_class: string; indication: string; started_on: string; stopped_on: string | null; stop_reason: string | null; by_nurse?: boolean | null };
type Reading = { taken_on: string; a1c: number | null; weight_kg: number | null; by_nurse?: boolean | null };
type Profile = Row & { medications: Med[]; readings: Reading[] };

const age = (y: number) => new Date().getFullYear() - y;
const month = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" });
const yearsSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / (365.25 * 86400000)));
const conditionLabel = (c: string) => (c === "Obesity" ? "Weight management" : c);

function Chips({ classes }: { classes?: string[] | null }) {
  if (!classes || !classes.length) return <span className="note">No current medicines</span>;
  return (
    <>
      {classes.map((c) => (
        <span key={c} className={"chip " + clsKey(c)}>{c}</span>
      ))}
    </>
  );
}

function Trend({ data, keyName, unit, goal, title }: { data: Reading[]; keyName: "a1c" | "weight_kg"; unit: string; goal?: number; title: string }) {
  const pts = data.filter((r) => r[keyName] !== null).map((r) => ({ date: r.taken_on, v: r[keyName] as number }));
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.v);
  const lo = Math.floor(Math.min(...vals, goal ?? Infinity) - (keyName === "a1c" ? 0.5 : 3));
  const hi = Math.ceil(Math.max(...vals, goal ?? -Infinity) + (keyName === "a1c" ? 0.5 : 3));
  return (
    <div className="mini">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={210}>
        <LineChart data={pts} margin={{ left: 0, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tickFormatter={(d) => month(String(d))} minTickGap={32} />
          <YAxis domain={[lo, hi]} width={44} tickFormatter={(v) => `${v}`} />
          <Tooltip formatter={(v) => `${v}${unit}`} labelFormatter={(d) => month(String(d))} />
          {goal && <ReferenceLine y={goal} stroke="var(--chart-2)" strokeDasharray="5 4" label={{ value: `${goal}${unit} common target`, fill: "var(--gold-ink)", fontSize: 12, position: "insideTopRight" }} />}
          <Line type="monotone" dataKey="v" name={title} stroke="var(--chart-1)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Detail({ id, onBack, onRemoved, onOpen }: { id: number; onBack: () => void; onRemoved: () => void; onOpen: Go }) {
  const { data, error } = useData<Profile>(`patients/${id}`);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [hi, setHi] = useState(true);
  useEffect(() => {
    if (!hi) return;
    const t = setTimeout(() => setHi(false), 1800);
    return () => clearTimeout(t);
  }, [hi]);

  if (error) return <><button onClick={onBack}>← All patients</button><p className="state err">Could not load this patient.</p></>;
  if (!data) return <p className="state">Loading…</p>;

  const a1cs = data.readings.filter((r) => r.a1c !== null);
  const wts = data.readings.filter((r) => r.weight_kg !== null);
  const delta = (xs: Reading[], k: "a1c" | "weight_kg") =>
    xs.length > 1 ? (xs[xs.length - 1][k]! - xs[0][k]!) : null;
  const dA = delta(a1cs, "a1c");
  const dW = delta(wts, "weight_kg");
  const current = data.medications.filter((m) => !m.stopped_on);

  const events = [
    ...(data.diagnosed_on ? [{ date: data.diagnosed_on, text: data.primary_condition === "Obesity" ? "Began weight-management care" : `Diagnosed: ${data.primary_condition}`, kind: "dx" }] : []),
    ...data.medications.flatMap((m) => [
      { date: m.started_on, text: `Started ${m.drug} for ${m.indication.toLowerCase()}${m.by_nurse ? " (entered by nurse)" : ""}`, kind: m.drug_class },
      ...(m.stopped_on ? [{ date: m.stopped_on, text: `Stopped ${m.drug}${m.stop_reason ? ` (${m.stop_reason})` : ""}`, kind: "stop" }] : []),
    ]),
    ...data.readings.filter((r) => r.by_nurse).map((r) => ({
      date: r.taken_on,
      text: `Reading entered by nurse: ${[r.a1c !== null ? `A1C ${r.a1c}%` : "", r.weight_kg !== null ? `${r.weight_kg} kg` : ""].filter(Boolean).join(", ")}`,
      kind: "nurse",
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  async function remove() {
    setBusy(true);
    try {
      await del(`patients/${id}`);
      onRemoved();
    } catch {
      setMsg("Could not remove this patient.");
      setBusy(false);
    }
  }

  return (
    <>
      <p><button onClick={onBack}>← All patients</button></p>
      <div className="profile-head">
        <button className="av-btn" onClick={() => setHi(true)} aria-label={`Say hi to ${nickname(data.patient_id)}`}>
          <Avatar id={data.patient_id} size={128} waving={hi} age={age(data.birth_year)} />
          {hi && <span className="say" role="status">Hi, I'm {nickname(data.patient_id)}!</span>}
        </button>
        <div>
          <h2>{nickname(data.patient_id)} <span className="pid">Patient #{data.patient_id}</span></h2>
          <p className="lede">{age(data.birth_year)} years old · {data.city} · clinic {data.clinic_id}</p>
          <p>
            <span className="cond">{conditionLabel(data.primary_condition)}</span>
            {data.diagnosed_on && <span className="note"> since {month(data.diagnosed_on)} ({yearsSince(data.diagnosed_on)} years)</span>}
            {data.by_nurse ? <span className="tagnew nurse">Added by nurse</span> : data.demo_created && <span className="tagnew">Added in demo</span>}
          </p>
          <p>
            <PayerTag payer={data.payer} /> <span className="note">{PAYER_NOTE[data.payer]}.</span>{" "}
            <button className="linkish" onClick={() => onOpen("payers")}>Compare Medicaid and Medicare →</button>
          </p>
        </div>
        <div className="profile-actions">
          {data.demo_created &&
            (confirm ? (
              <>
                <button className="danger" onClick={remove} disabled={busy}>{busy ? "Removing…" : "Yes, remove"}</button>
                <button onClick={() => setConfirm(false)}>Cancel</button>
              </>
            ) : (
              <button onClick={() => setConfirm(true)}>Remove patient</button>
            ))}
        </div>
      </div>
      {msg && <p className="state err">{msg}</p>}

      <div className="statrow">
        <div className="stat">
          <p className="kpi-label">Latest A1C</p>
          <p className="big">{a1cs.length ? `${a1cs[a1cs.length - 1].a1c}%` : "Not measured"}</p>
          {dA !== null && <p className="note">{dA <= 0 ? "Down" : "Up"} {Math.abs(dA).toFixed(1)} points since {month(a1cs[0].taken_on)}</p>}
        </div>
        <div className="stat">
          <p className="kpi-label">Latest weight</p>
          <p className="big">{wts.length ? `${wts[wts.length - 1].weight_kg} kg` : "Not measured"}</p>
          {dW !== null && <p className="note">{dW <= 0 ? "Down" : "Up"} {Math.abs(dW).toFixed(1)} kg since {month(wts[0].taken_on)}</p>}
        </div>
        <div className="stat">
          <p className="kpi-label">Taking now</p>
          <p className="big">{current.length}</p>
          <p className="note">{current.length ? current.map((m) => m.drug).join(", ") : "No current medicines"}</p>
        </div>
      </div>

      <div className="chart-row">
        <Trend data={data.readings} keyName="a1c" unit="%" goal={7} title="A1C over time" />
        <Trend data={data.readings} keyName="weight_kg" unit=" kg" title="Weight over time" />
      </div>
      <p className="note">A1C reflects average blood sugar over about three months. Lower means better controlled. The dashed line marks a target commonly used for many adults; individual targets differ.</p>

      <h3 className="sec">History</h3>
      <ol className="timeline">
        {events.map((e, i) => (
          <li key={i} className={"ev ev-" + (e.kind === "dx" || e.kind === "stop" ? e.kind : clsKey(e.kind))}>
            <span className="ev-date">{month(e.date)}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
      <p className="note">
        Synthetic patient. The nickname is made up in your browser from the patient number; it is not stored and is not a real name. Drug classes are the same four used in the Medicaid data.{" "}
        <button className="linkish" onClick={() => onOpen("drugs")}>What do these classes do? →</button>
      </p>
    </>
  );
}

function Card({ p, onPick }: { p: Row; onPick: () => void }) {
  const [hi, setHi] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const nick = nickname(p.patient_id);
  const click = () => {
    if (hi) return;
    setHi(true);
    timer.current = setTimeout(onPick, 800);
  };
  return (
    <button className={"pcard" + (hi ? " hi" : "")} onClick={click}>
      <span className="av-wrap">
        <Avatar id={p.patient_id} size={52} waving={hi} age={age(p.birth_year)} />
        {hi && <span className="say" role="status">Hi, I'm {nick}!</span>}
      </span>
      <span className="pbody">
        <strong>{nick} <span className="pid">#{p.patient_id}</span></strong>
        <span className="note">{age(p.birth_year)} · {p.city}</span>
        <span><PayerTag payer={p.payer} /></span>
        <span className="cond">{conditionLabel(p.primary_condition)}</span>
        <span className="chips"><Chips classes={p.current_classes} />{p.by_nurse ? <span className="tagnew nurse">Added by nurse</span> : p.demo_created && <span className="tagnew">New</span>}</span>
      </span>
    </button>
  );
}

export default function Patients({ onOpen }: { onOpen: Go }) {
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const list = useData<Row[]>(`patients?v=${version}`);
  const [cover, setCover] = useState<Payer | "All">("All");

  async function add() {
    setAdding(true);
    setMsg("");
    try {
      const r = await post<{ patient_id: number }>("patients/generate", {});
      setVersion((v) => v + 1);
      setOpen(r.patient_id);
    } catch (e) {
      const s = e instanceof ApiError ? e.status : 0;
      setMsg(
        s === 429
          ? "You have reached the hourly limit for adding demo patients. Try again later."
          : s === 409
            ? "The demo holds at most 30 added patients per clinic. Remove one first; added patients also expire after six hours."
            : "Could not add a patient. Try again in a minute."
      );
    } finally {
      setAdding(false);
    }
  }

  if (open !== null)
    return (
      <Detail
        id={open}
        onBack={() => setOpen(null)}
        onRemoved={() => {
          setVersion((v) => v + 1);
          setOpen(null);
        }}
        onOpen={onOpen}
      />
    );

  if (list.error) return <p className="state err">{list.error}</p>;
  if (!list.data) return <p className="state">Loading…</p>;

  const counts = PAYERS.map((k) => [k, list.data!.filter((r) => r.payer === k).length] as const);
  const shown = cover === "All" ? list.data : list.data.filter((r) => r.payer === cover);

  return (
    <>
      <div className="listbar">
        <p className="note">
          {list.data.length} synthetic patients in your clinic. Real names and birth dates are hidden from every role, so each
          patient gets a friendly nickname made up in your browser. Select one to say hi and open the full history.
        </p>
        <button className="primary" onClick={add} disabled={adding}>{adding ? "Adding…" : "+ Add synthetic patient"}</button>
      </div>
      {msg && <p className="state err">{msg}</p>}
      <p className="note">
        Add creates a random fictional patient. No typing is needed, so no real information can be entered. Only
        patients added here can be removed.
      </p>
      <div className="payer-filter" role="group" aria-label="Filter by coverage">
        <button className={cover === "All" ? "on" : ""} onClick={() => setCover("All")}>All ({list.data.length})</button>
        {counts.map(([k, n]) => (
          <button key={k} className={cover === k ? "on" : ""} onClick={() => setCover(k)} title={PAYER_NOTE[k]}>{k} ({n})</button>
        ))}
      </div>
      <p className="note">
        Coverage is a synthetic field assigned by a fixed rule from age (65 and over mostly Medicare, some also Medicaid; under 65
        mostly Medicaid or an employer plan). It shows how a clinician would see who pays, and is not real coverage.
      </p>
      <div className="pgrid">
        {shown.map((p) => (
          <Card key={p.patient_id} p={p} onPick={() => setOpen(p.patient_id)} />
        ))}
      </div>
    </>
  );
}
