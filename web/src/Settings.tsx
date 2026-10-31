import { useState, type FormEvent } from "react";

type Props = {
  email: string;
  role: string;
  defaultName: string;
  custom: string;
  access: string;
  onSave: (name: string) => void;
  onReplayTour: () => void;
};

export default function Settings({ email, role, defaultName, custom, access, onSave, onReplayTour }: Props) {
  const [value, setValue] = useState(custom);
  const [saved, setSaved] = useState(false);

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
      <h2 className="sec">Welcome tour</h2>
      <p className="note">A three-step introduction to what CareBoard shows and what your role can see.</p>
      <button type="button" onClick={onReplayTour}>Replay the welcome tour</button>
    </div>
  );
}
