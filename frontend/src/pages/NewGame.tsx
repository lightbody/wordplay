import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi, useProfile } from "../profile";
import { useFriendsShape } from "../shapes";
import { Avatar } from "../components/Avatar";
import { Switch } from "../components/Switch";

export function NewGame() {
  const profile = useProfile();
  const getApi = useApi();
  const navigate = useNavigate();
  const { data: friends } = useFriendsShape();
  const [deductUnused, setDeductUnused] = useState(profile.default_deduct_unused);
  const [creating, setCreating] = useState(false);

  async function create(friendId?: string) {
    setCreating(true);
    try {
      const api = await getApi();
      const { game } = await api.createGame(deductUnused, friendId);
      navigate(`/games/${game.id}`, { replace: true });
    } catch {
      setCreating(false);
    }
  }

  const sorted = [...(friends ?? [])].sort((a, b) => a.friend_username.localeCompare(b.friend_username));

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
        </div>

        <div className="card">
          <h2>Play with a friend</h2>
          {sorted.length > 0 ? (
            <div className="friend-rows friend-picker">
              {sorted.map((f) => (
                <button
                  key={f.friend_id}
                  className="friend-row friend-pick"
                  disabled={creating}
                  onClick={() => create(f.friend_id)}
                >
                  <Avatar
                    name={f.friend_username}
                    emoji={f.friend_avatar_emoji}
                    color={f.friend_avatar_color}
                    size={40}
                  />
                  <span className="friend-name">@{f.friend_username}</span>
                  <span className="badge badge-accent">Play</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">
              No friends yet — share your <Link to="/friends">friend link</Link> to add one, or start with an
              invite link below.
            </p>
          )}
          {sorted.length > 0 && (
            <p className="muted">
              You'll play the opening move next; the game shows up for them once it's played.
            </p>
          )}
        </div>

        <div className="card">
          <h2>Play with a link</h2>
          <p className="muted">
            Start solo: play your opening move, then share an invite link with anyone — they become a friend
            when they join.
          </p>
          <button className="btn btn-primary btn-lg btn-block" disabled={creating} onClick={() => create()}>
            {creating ? "Creating…" : "Start & play first move"}
          </button>
        </div>
      </div>
    </div>
  );
}
