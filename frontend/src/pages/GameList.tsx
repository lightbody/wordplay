import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { useFriendsShape, useGamesShape } from "../shapes";
import { useProfile, useProfileContext, useApi } from "../profile";
import { canNudge, canRematch, opponentIdOf, visibleGame } from "../gameList";
import { shareOrCopy } from "../share";
import type { Game } from "../types";
import { Spinner } from "../components/Spinner";
import { Avatar } from "../components/Avatar";
import { AccountMenu } from "../components/AccountMenu";
import { Dialog } from "../components/Dialog";
import { Toast } from "../components/Toast";

export interface View {
  game: Game;
  meCreator: boolean;
  myScore: number;
  theirScore: number;
  opponentName: string;
  opponentAvatarEmoji: string | null;
  opponentAvatarColor: string | null;
  myTurn: boolean;
  outcome: "win" | "loss" | "draw" | null;
  rematchable: boolean;
  nudgeable: boolean;
}

/** Pure per-card view model, shared with the game-list harness (mock data, no shapes/auth). */
export function gameToView(game: Game, profileId: string, friendIds: Set<string>, now: number): View {
  const meCreator = game.creator_id === profileId;
  const outcome: View["outcome"] =
    game.status !== "finished" ? null : !game.winner_id ? "draw" : game.winner_id === profileId ? "win" : "loss";
  return {
    game,
    meCreator,
    myScore: meCreator ? game.creator_score : game.opponent_score,
    theirScore: meCreator ? game.opponent_score : game.creator_score,
    opponentName: (meCreator ? game.opponent_username : game.creator_username) ?? "waiting…",
    opponentAvatarEmoji: meCreator ? game.opponent_avatar_emoji : game.creator_avatar_emoji,
    opponentAvatarColor: meCreator ? game.opponent_avatar_color : game.creator_avatar_color,
    myTurn: game.current_player_id === profileId,
    outcome,
    rematchable: canRematch(game, profileId, friendIds),
    nudgeable: canNudge(game, profileId, now),
  };
}

export function GameList() {
  const profile = useProfile();
  const { setProfile } = useProfileContext();
  const getApi = useApi();
  const { signOut, user, getAccessToken } = useAuth();
  const navigate = useNavigate();
  const { data: games, isLoading } = useGamesShape();
  const { data: friends } = useFriendsShape();
  const [rematching, setRematching] = useState<string | null>(null);
  const [nudging, setNudging] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [nudgeFallback, setNudgeFallback] = useState<View | null>(null);

  const friendIds = useMemo(() => new Set((friends ?? []).map((f) => f.friend_id)), [friends]);

  // Nudge buttons are hidden until allowed, and the cooldowns lapse without
  // any sync event to re-render on — tick once a minute so they appear.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const views = useMemo<View[]>(() => {
    return (games ?? [])
      .filter(visibleGame)
      .map((game) => gameToView(game, profile.id, friendIds, now))
      .sort((a, b) => (a.game.updated_at < b.game.updated_at ? 1 : -1));
  }, [games, profile.id, friendIds, now]);

  const yourTurn = views.filter((v) => v.game.status === "active" && v.myTurn);
  const theirTurn = views.filter((v) => v.game.status === "active" && !v.myTurn);
  const finished = views.filter((v) => v.game.status === "finished");

  async function rematch(view: View) {
    const opponentId = opponentIdOf(view.game, profile.id);
    if (!opponentId || rematching) return;
    setRematching(view.game.id);
    try {
      const api = await getApi();
      // Server-side pending-game reuse makes repeat taps converge on one game.
      const { game } = await api.createGame(view.game.deduct_unused, opponentId);
      navigate(`/games/${game.id}`);
    } catch {
      setRematching(null);
    }
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  }

  async function nudge(view: View) {
    if (nudging) return;
    setNudging(view.game.id);
    try {
      const api = await getApi();
      const { opponent_push } = await api.nudge(view.game.id);
      if (opponent_push.likely_receiving) {
        showToast(`Nudged @${view.opponentName}!`);
      } else {
        // They probably won't see the push — offer the share-sheet backup.
        setNudgeFallback(view);
      }
    } catch {
      // Benign races only (another device already nudged / clock skew): the
      // synced nudge timestamp will hide the button momentarily.
    } finally {
      setNudging(null);
    }
  }

  async function shareNudge(view: View) {
    const result = await shareOrCopy({
      title: "Wordplay",
      text: "Your move in our Wordplay game!",
      url: `${window.location.origin}/games/${view.game.id}`,
    });
    setNudgeFallback(null);
    if (result === "copied") showToast("Link copied!");
  }

  return (
    <div className="app-page">
      <header className="topbar">
        <span className="wordmark wordmark-sm">Wordplay</span>
        <AccountMenu
          username={profile.username}
          email={user?.email}
          avatarEmoji={profile.avatar_emoji}
          avatarColor={profile.avatar_color}
          onAvatarSave={async (emoji, color) => {
            const api = await getApi();
            const updated = await api.updateAvatar(emoji, color);
            setProfile(updated);
          }}
          onFriends={() => navigate("/friends")}
          onSignOut={() => signOut()}
          getAccessToken={getAccessToken}
        />
      </header>

      <div className="content">
        <button className="btn btn-primary btn-lg btn-block" onClick={() => navigate("/new")}>
          + New game
        </button>

        {isLoading && <Spinner />}

        <Section title="Your turn" views={yourTurn} accent />
        <Section title="Their turn" views={theirTurn} onNudge={nudge} nudging={nudging} />
        <Section title="Finished" views={finished} finished onRematch={rematch} rematching={rematching} />

        {!isLoading && views.length === 0 && (
          <p className="empty-state">No games yet. Start one!</p>
        )}
      </div>

      {nudgeFallback && (
        <Dialog
          title="Nudge sent"
          onClose={() => setNudgeFallback(null)}
          actions={
            <>
              <button className="btn btn-ghost" onClick={() => setNudgeFallback(null)}>
                Done
              </button>
              <button className="btn btn-primary" onClick={() => shareNudge(nudgeFallback)}>
                Text them
              </button>
            </>
          }
        >
          <p className="muted">
            @{nudgeFallback.opponentName} doesn't seem to be getting notifications — send them the game link
            directly.
          </p>
        </Dialog>
      )}

      {toast && (
        <div className="share-toast-wrap">
          <Toast tone="success">{toast}</Toast>
        </div>
      )}
    </div>
  );
}

export function Section({
  title,
  views,
  accent,
  finished,
  onRematch,
  rematching,
  onNudge,
  nudging,
}: {
  title: string;
  views: View[];
  accent?: boolean;
  finished?: boolean;
  onRematch?: (view: View) => void;
  rematching?: string | null;
  onNudge?: (view: View) => void;
  nudging?: string | null;
}) {
  if (views.length === 0) return null;
  return (
    <section className="game-section">
      <h2 className={accent ? "section-title accent" : "section-title"}>{title}</h2>
      <div className="game-cards">
        {views.map((v) => (
          <Link
            key={v.game.id}
            to={finished ? `/games/${v.game.id}/summary` : `/games/${v.game.id}`}
            className={`game-card${accent ? " game-card-accent" : ""}`}
          >
            <div className="game-card-main">
              <Avatar name={v.opponentName} emoji={v.opponentAvatarEmoji} color={v.opponentAvatarColor} size={40} />
              <div className="game-card-text">
                <span className="opponent">vs @{v.opponentName}</span>
                <span className="score-line">
                  {v.myScore} – {v.theirScore}
                </span>
              </div>
            </div>
            <div className="game-card-meta">
              {v.game.status === "finished" ? (
                <>
                  {v.outcome === "draw" ? (
                    <span className="badge">Draw</span>
                  ) : (
                    <span className={`badge ${v.outcome === "win" ? "badge-win" : "badge-loss"}`}>
                      {v.outcome === "win" ? "You won" : "You lost"}
                    </span>
                  )}
                  {v.rematchable && onRematch && (
                    <button
                      className="btn btn-ghost rematch-btn"
                      disabled={rematching !== null}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRematch(v);
                      }}
                    >
                      {rematching === v.game.id ? "Starting…" : "Rematch"}
                    </button>
                  )}
                </>
              ) : v.myTurn ? (
                <span className="badge badge-accent">Your move</span>
              ) : v.nudgeable && onNudge ? (
                <button
                  className="btn btn-ghost nudge-btn"
                  disabled={nudging !== null}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onNudge(v);
                  }}
                >
                  {nudging === v.game.id ? "Nudging…" : "Nudge"}
                </button>
              ) : (
                <span className="badge badge-muted">Waiting</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
