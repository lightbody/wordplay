import { motion } from "motion/react";
import type { Game } from "../types";

export function ScoreBar({
  game,
  meCreator,
  myTurn,
}: {
  game: Game;
  meCreator: boolean;
  myTurn: boolean;
}) {
  const me = {
    name: meCreator ? game.creator_username : game.opponent_username ?? "You",
    score: meCreator ? game.creator_score : game.opponent_score,
  };
  const them = {
    name: (meCreator ? game.opponent_username : game.creator_username) ?? "…",
    score: meCreator ? game.opponent_score : game.creator_score,
  };

  return (
    <div className="scorebar">
      <Player name={`@${me.name}`} score={me.score} active={myTurn} you />
      <div className="scorebar-mid">
        <span className="tiles-left">{game.tiles_remaining} left</span>
      </div>
      <Player name={`@${them.name}`} score={them.score} active={!myTurn && game.status === "active"} />
    </div>
  );
}

function Player({ name, score, active, you }: { name: string; score: number; active: boolean; you?: boolean }) {
  return (
    <div className={`scorebar-player${active ? " active" : ""}`}>
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
  );
}
