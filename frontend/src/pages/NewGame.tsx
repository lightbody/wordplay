import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi, useProfile } from "../profile";
import { Switch } from "../components/Switch";

export function NewGame() {
  const profile = useProfile();
  const getApi = useApi();
  const navigate = useNavigate();
  const [deductUnused, setDeductUnused] = useState(profile.default_deduct_unused);
  const [creating, setCreating] = useState(false);

  async function create() {
    setCreating(true);
    try {
      const api = await getApi();
      const { game } = await api.createGame(deductUnused);
      navigate(`/games/${game.id}`, { replace: true });
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className="app-page">
      <header className="topbar">
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          ← Back
        </button>
        <span className="wordmark wordmark-sm">New game</span>
        <span />
      </header>

      <div className="content">
        <div className="card">
          <h2>Game options</h2>
          <div className="settings-row">
            <span>
              <strong>Deduct unused tile values from final score</strong>
              <small>At game end, each player loses points for tiles left on their rack.</small>
            </span>
            <Switch
              checked={deductUnused}
              onChange={setDeductUnused}
              aria-label="Deduct unused tile values from final score"
            />
          </div>
          <p className="muted">
            You'll play the opening move next, then challenge a friend by username or share an
            invite link.
          </p>
          <button className="btn btn-primary btn-lg btn-block" disabled={creating} onClick={create}>
            {creating ? "Creating…" : "Start & play first move"}
          </button>
        </div>
      </div>
    </div>
  );
}
