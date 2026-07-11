import { motion } from "motion/react";
import { BAG_SIZE } from "@wordplay/shared";
import type { Game } from "../types";
import { Avatar } from "./Avatar";

export function ScoreBar({
  game,
  meCreator,
  myTurn,
  onOpenUnseenTiles,
}: {
  game: Game;
  meCreator: boolean;
  myTurn: boolean;
  onOpenUnseenTiles: () => void;
}) {
  const me = {
    name: meCreator ? game.creator_username : game.opponent_username ?? "You",
    score: meCreator ? game.creator_score : game.opponent_score,
    emoji: meCreator ? game.creator_avatar_emoji : game.opponent_avatar_emoji,
    color: meCreator ? game.creator_avatar_color : game.opponent_avatar_color,
  };
  // Before a friend game's opening move lands, the opponent isn't attached
  // yet — fall back to the pending_* columns so the creator still sees who
  // they're playing.
  const them = {
    name:
      (meCreator ? game.opponent_username ?? game.pending_opponent_username : game.creator_username) ?? "…",
    score: meCreator ? game.opponent_score : game.creator_score,
    emoji: meCreator
      ? game.opponent_avatar_emoji ?? game.pending_opponent_avatar_emoji
      : game.creator_avatar_emoji,
    color: meCreator
      ? game.opponent_avatar_color ?? game.pending_opponent_avatar_color
      : game.creator_avatar_color,
  };

  return (
    <div className="scorebar">
      <Player name={`@${me.name}`} emoji={me.emoji} color={me.color} score={me.score} active={myTurn} you />
      <TilesLeft count={game.tiles_remaining} onOpen={onOpenUnseenTiles} />
      <Player
        name={`@${them.name}`}
        emoji={them.emoji}
        color={them.color}
        score={them.score}
        active={!myTurn && game.status === "active"}
      />
    </div>
  );
}

function Player({
  name,
  emoji,
  color,
  score,
  active,
  you,
}: {
  name: string;
  emoji?: string | null;
  color?: string | null;
  score: number;
  active: boolean;
  you?: boolean;
}) {
  return (
    <div className={`scorebar-player${active ? " active" : ""}`}>
      <Avatar name={name} emoji={emoji} color={color} size={28} />
      <div className="scorebar-player-text">
        <span className="player-name">
          {name}
          {you ? " (you)" : ""}
        </span>
        <motion.span
          key={score}
          className="player-score"
          initial={{ scale: 1.3, color: "var(--accent)" }}
          animate={{ scale: 1, color: "var(--text)" }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
        >
          {score}
        </motion.span>
      </div>
    </div>
  );
}

function TilesLeft({ count, onOpen }: { count: number; onOpen: () => void }) {
  const pct = Math.max(0, Math.min(100, Math.round((count / BAG_SIZE) * 100)));
  return (
    <button
      type="button"
      className="tiles-ring"
      style={{ "--pct": pct } as React.CSSProperties}
      onClick={onOpen}
      aria-label="Show unseen tiles"
    >
      <div className="tiles-ring-inner">
        <span className="tiles-ring-count">{count}</span>
        <span className="tiles-ring-label">left</span>
      </div>
    </button>
  );
}
