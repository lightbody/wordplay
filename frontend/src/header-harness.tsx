// Persistent harness for the streamlined in-game topbar (icon-only back
// chevron) and the redesigned ScoreBar (avatars, active-turn highlight,
// tiles-remaining ring). GameScreen itself needs WorkOS auth + a live
// backend + ElectricSQL, none of which are available in a Claude Code
// remote session, so this mounts the real components with hand-built mock
// data instead. Not part of the app: not imported from main.tsx, not linked
// from any route. `npm run dev` and navigate to /header-harness.html. See
// CLAUDE.md.
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./theme";
import { ScoreBar } from "./components/ScoreBar";
import { LastMoveSummary } from "./components/LastMoveSummary";
import type { Game } from "./types";
import "./App.css";

function makeGame(overrides: Partial<Game>): Game {
  return {
    id: "g1",
    status: "active",
    creator_id: "me",
    opponent_id: "them",
    creator_username: "PSquad32",
    opponent_username: "clightbo",
    current_player_id: "me",
    deduct_unused: false,
    board: "",
    tiles_remaining: 45,
    creator_rack_count: 7,
    opponent_rack_count: 7,
    creator_score: 111,
    opponent_score: 124,
    move_count: 12,
    scoreless_streak: 0,
    final_moves_remaining: null,
    ended_reason: null,
    winner_id: null,
    creator_adjustment: 0,
    opponent_adjustment: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function Harness() {
  const myTurn = makeGame({ current_player_id: "me", tiles_remaining: 82 });
  const theirTurn = makeGame({ current_player_id: "them", tiles_remaining: 12, opponent_username: "scottyfischer" });
  return (
    <ThemeProvider>
      <div className="app-page game-screen">
        <header className="topbar game-header">
          <button className="icon-btn" aria-label="Back to games">
            <span className="chevron-left" />
          </button>
        </header>
        <div className="game-middle">
          <ScoreBar game={myTurn} meCreator={true} myTurn={true} />
          <LastMoveSummary summary={{ mine: true, word: "QUIXOTIC", points: 42 }} />
          <div style={{ height: 1, background: "var(--border-subtle)" }} />
          <ScoreBar game={theirTurn} meCreator={true} myTurn={false} />
          <LastMoveSummary summary={{ mine: false, word: "ZEBRA", points: 18 }} />
        </div>
      </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
