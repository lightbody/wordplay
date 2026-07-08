import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useProfile } from "../profile";
import { useGamesShape, useMovesShape } from "../shapes";
import type { Game, Move } from "../types";
import { Spinner } from "../components/Spinner";

const CREATOR_COLOR = "var(--accent-primary)";
const OPPONENT_COLOR = "var(--sky-600)";

export function Summary() {
  const { id } = useParams<{ id: string }>();
  const profile = useProfile();
  const navigate = useNavigate();
  const { data: games } = useGamesShape();
  const { data: moves } = useMovesShape(id!);

  const game = useMemo<Game | undefined>(() => games?.find((g) => g.id === id), [games, id]);

  const { series, creatorStats, opponentStats } = useMemo(
    () => computeStats(game, moves ?? []),
    [game, moves],
  );

  if (!game) return <Spinner full />;

  const meCreator = game.creator_id === profile.id;
  const creatorFinal = game.creator_score + game.creator_adjustment;
  const opponentFinal = game.opponent_score + game.opponent_adjustment;
  const myFinal = meCreator ? creatorFinal : opponentFinal;
  const theirFinal = meCreator ? opponentFinal : creatorFinal;

  const outcome = !game.winner_id ? "draw" : game.winner_id === profile.id ? "win" : "loss";
  const banner =
    outcome === "draw" ? "It's a draw!" : outcome === "win" ? "You won! 🎉" : "You lost";

  const reasonText: Record<string, string> = {
    resigned: "Game ended by resignation",
    bag_final_moves: "Bag emptied — final moves played",
    played_out: "A player used all their tiles",
    scoreless_limit: "Ended after consecutive scoreless turns",
  };

  const myStats = meCreator ? creatorStats : opponentStats;
  const theirStats = meCreator ? opponentStats : creatorStats;

  return (
    <div className="app-page">
      <header className="topbar">
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          ← Games
        </button>
        <span className="wordmark wordmark-sm">Summary</span>
        <span />
      </header>

      <div className="content summary">
        <div className={`result-banner result-${outcome}`}>
          <h1>{banner}</h1>
          <p>{game.ended_reason ? reasonText[game.ended_reason] : ""}</p>
        </div>

        <div className="final-scores">
          <ScoreCol
            label={`@${meCreator ? game.creator_username : game.opponent_username}`}
            you
            score={meCreator ? game.creator_score : game.opponent_score}
            adjustment={meCreator ? game.creator_adjustment : game.opponent_adjustment}
            final={myFinal}
          />
          <span className="vs">vs</span>
          <ScoreCol
            label={`@${meCreator ? game.opponent_username : game.creator_username}`}
            score={meCreator ? game.opponent_score : game.creator_score}
            adjustment={meCreator ? game.opponent_adjustment : game.creator_adjustment}
            final={theirFinal}
          />
        </div>

        <div className="card">
          <h3>Scores over time</h3>
          <div className="chart">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="move" stroke="var(--muted)" fontSize={12} />
                <YAxis stroke="var(--muted)" fontSize={12} />
                <Tooltip
                  contentStyle={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    font: "var(--text-body-sm)",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="creator"
                  name={game.creator_username}
                  stroke={CREATOR_COLOR}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="opponent"
                  name={game.opponent_username ?? "opponent"}
                  stroke={OPPONENT_COLOR}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="stats-grid">
          <StatTiles title={`You (@${meCreator ? game.creator_username : game.opponent_username})`} stats={myStats} />
          <StatTiles title={`@${meCreator ? game.opponent_username : game.creator_username}`} stats={theirStats} />
        </div>
      </div>
    </div>
  );
}

function ScoreCol({
  label,
  score,
  adjustment,
  final,
  you,
}: {
  label: string;
  score: number;
  adjustment: number;
  final: number;
  you?: boolean;
}) {
  return (
    <div className="score-col">
      <span className="score-col-label">
        {label}
        {you ? " (you)" : ""}
      </span>
      <span className="score-col-final">{final}</span>
      {adjustment !== 0 && (
        <span className="score-col-adj">
          {score} {adjustment} unused
        </span>
      )}
    </div>
  );
}

interface Stats {
  min: number;
  max: number;
  avg: number;
  best: string;
  bingos: number;
  plays: number;
}

function StatTiles({ title, stats }: { title: string; stats: Stats }) {
  return (
    <div className="card stat-card">
      <h4>{title}</h4>
      <div className="stat-tiles">
        <Stat label="Best move" value={stats.max} />
        <Stat label="Avg move" value={stats.avg} />
        <Stat label="Lowest" value={stats.min} />
        <Stat label="Bingos" value={stats.bingos} />
      </div>
      {stats.best && <p className="best-word">Best word: <strong>{stats.best}</strong></p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function emptyStats(): Stats {
  return { min: 0, max: 0, avg: 0, best: "", bingos: 0, plays: 0 };
}

function computeStats(game: Game | undefined, moves: Move[]) {
  const ordered = [...moves].sort((a, b) => a.move_number - b.move_number);
  const series: Array<{ move: number; creator: number; opponent: number }> = [
    { move: 0, creator: 0, opponent: 0 },
  ];
  let creatorTotal = 0;
  let opponentTotal = 0;

  const creatorScores: number[] = [];
  const opponentScores: number[] = [];
  let creatorBest = { word: "", score: -1 };
  let opponentBest = { word: "", score: -1 };
  let creatorBingos = 0;
  let opponentBingos = 0;

  for (const m of ordered) {
    const isCreator = game && m.user_id === game.creator_id;
    if (isCreator) creatorTotal += m.score;
    else opponentTotal += m.score;

    if (m.move_type === "play") {
      const target = isCreator ? creatorScores : opponentScores;
      target.push(m.score);
      if (m.tiles && m.tiles.length === 7) {
        if (isCreator) creatorBingos++;
        else opponentBingos++;
      }
      const topWord = m.words?.[0];
      if (topWord) {
        const best = isCreator ? creatorBest : opponentBest;
        if (topWord.score > best.score) {
          best.word = topWord.word;
          best.score = topWord.score;
        }
      }
    }
    series.push({ move: m.move_number, creator: creatorTotal, opponent: opponentTotal });
  }

  const summarize = (scores: number[], best: { word: string; score: number }, bingos: number): Stats => {
    if (scores.length === 0) return emptyStats();
    const sum = scores.reduce((a, b) => a + b, 0);
    return {
      min: Math.min(...scores),
      max: Math.max(...scores),
      avg: Math.round(sum / scores.length),
      best: best.word,
      bingos,
      plays: scores.length,
    };
  };

  return {
    series,
    creatorStats: summarize(creatorScores, creatorBest, creatorBingos),
    opponentStats: summarize(opponentScores, opponentBest, opponentBingos),
  };
}
