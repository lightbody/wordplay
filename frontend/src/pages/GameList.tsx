import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { useFriendsShape, useGamesShape } from "../shapes";
import { useProfile, useProfileContext, useApi } from "../profile";
import { canRematch, opponentIdOf, visibleGame } from "../gameList";
import type { Game } from "../types";
import { Spinner } from "../components/Spinner";
import { Avatar } from "../components/Avatar";
import { AccountMenu } from "../components/AccountMenu";

interface View {
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

  const friendIds = useMemo(() => new Set((friends ?? []).map((f) => f.friend_id)), [friends]);

  const views = useMemo<View[]>(() => {
    return (games ?? [])
      .filter(visibleGame)
      .map((game) => {
        const meCreator = game.creator_id === profile.id;
        const outcome: View["outcome"] =
          game.status !== "finished"
            ? null
            : !game.winner_id
              ? "draw"
              : game.winner_id === profile.id
                ? "win"
                : "loss";
        return {
          game,
          meCreator,
          myScore: meCreator ? game.creator_score : game.opponent_score,
          theirScore: meCreator ? game.opponent_score : game.creator_score,
          opponentName:
            (meCreator ? game.opponent_username : game.creator_username) ?? "waiting…",
          opponentAvatarEmoji: meCreator ? game.opponent_avatar_emoji : game.creator_avatar_emoji,
          opponentAvatarColor: meCreator ? game.opponent_avatar_color : game.creator_avatar_color,
          myTurn: game.current_player_id === profile.id,
          outcome,
          rematchable: canRematch(game, profile.id, friendIds),
        };
      })
      .sort((a, b) => (a.game.updated_at < b.game.updated_at ? 1 : -1));
  }, [games, profile.id, friendIds]);

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
        <Section title="Their turn" views={theirTurn} />
        <Section title="Finished" views={finished} finished onRematch={rematch} rematching={rematching} />

        {!isLoading && views.length === 0 && (
          <p className="empty-state">No games yet. Start one!</p>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  views,
  accent,
  finished,
  onRematch,
  rematching,
}: {
  title: string;
  views: View[];
  accent?: boolean;
  finished?: boolean;
  onRematch?: (view: View) => void;
  rematching?: string | null;
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
