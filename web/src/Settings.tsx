import { useState, type FormEvent } from "react";
import { FONTS, useAppearance, type FontKey, type Theme } from "./appearance";

type Props = {
  email: string;
  role: string;
  defaultName: string;
  custom: string;
  access: string;
  onSave: (name: string) => void;
  onReplayTour?: () => void;
};

export default function Settings({ email, role, defaultName, custom, access, onSave, onReplayTour }: Props) {
  const [value, setValue] = useState(custom);
  const [saved, setSaved] = useState(false);
  const [look, setLook] = useAppearance();

  function submit(e: FormEvent) {
    e.preventDefault();
    onSave(value);
    setSaved(true);
  }

  return (
    <div className="settings">
      <dl className="facts">
        <dt>Account email</dt>
        <dd>{email}</dd>
        <dt>Role</dt>
        <dd style={{ textTransform: "capitalize" }}>{role}</dd>
        <dt>Access</dt>
        <dd>{access}</dd>
      </dl>

      <form className="name-form" onSubmit={submit}>
        <label className="field">
          <span>Display name</span>
          <input
            value={value}
            maxLength={30}
            placeholder={defaultName}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
          />
        </label>
        <div className="row">
          <button type="submit" className="primary">Save</button>
          <button
            type="button"
            onClick={() => {
              setValue("");
              onSave("");
              setSaved(true);
            }}
          >
            Reset
          </button>
          {saved && <span className="saved" role="status">Saved</span>}
        </div>
        <p className="note">
          The name appears in your greeting on the Overview page. It is stored in this browser only; the email and role
          are set by the database and cannot be changed here.
        </p>
      </form>
      <h2 className="sec">Appearance</h2>
      <div className="appearance">
        <div className="opt">
          <span>Theme<small>Light, dark, or follow your device.</small></span>
          <div className="seg" role="group" aria-label="Theme">
            {(["light", "dark", "system"] as Theme[]).map((t) => (
              <button key={t} type="button" className={look.theme === t ? "on" : ""} aria-pressed={look.theme === t} onClick={() => setLook({ theme: t })}>
                {t === "system" ? "Match my device" : t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
        <div className="opt">
          <span>Font<small>Stored in this browser only.</small></span>
          <select value={look.font} onChange={(e) => setLook({ font: e.target.value as FontKey })} aria-label="Font">
            {FONTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
      </div>
      {onReplayTour && (
        <>
          <h2 className="sec">Welcome tour</h2>
          <p className="note">A three-step introduction to what CareBoard shows and what your role can see.</p>
          <button type="button" onClick={onReplayTour}>Replay the welcome tour</button>
        </>
      )}
    </div>
  );
}
