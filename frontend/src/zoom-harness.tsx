// Persistent harness for BoardViewport's pinch/pan/zoom behavior (including
// the zoom-crop drop-shadow overlay). GameScreen itself needs WorkOS auth +
// a live backend + ElectricSQL, none of which are available in a Claude
// Code remote session, so this mounts the real components with hand-built
// mock data instead. Not part of the app: not imported from main.tsx, not
// linked from any route. `npm run dev` and navigate to /zoom-harness.html.
// See CLAUDE.md.
import { createRoot } from "react-dom/client";
import { N } from "./engine";
import { ThemeProvider } from "./theme";
import { Board } from "./components/Board";
import { BoardViewport } from "./components/BoardViewport";
import { ScoreBar } from "./components/ScoreBar";
import type { Game } from "./types";
import "./App.css";

const EMPTY_BOARD = ".".repeat(N * N);

const game: Game = {
  id: "g1",
  status: "active",
  creator_id: "me",
  opponent_id: "them",
  creator_username: "PSquad32",
  opponent_username: "clightbo",
  creator_avatar_emoji: "🦊",
  creator_avatar_color: "coral-vivid",
  opponent_avatar_emoji: "🐢",
  opponent_avatar_color: "sky-vivid",
  pending_opponent_id: null,
  pending_opponent_username: null,
  pending_opponent_avatar_emoji: null,
  pending_opponent_avatar_color: null,
  current_player_id: "me",
  deduct_unused: false,
  board: EMPTY_BOARD,
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
};

function Harness() {
  return (
    <ThemeProvider>
      <div className="app-page game-screen">
        <header className="topbar game-header">
          <button className="icon-btn" aria-label="Back to games">
            <span className="chevron-left" />
          </button>
        </header>
        <div className="game-middle">
          <ScoreBar game={game} meCreator={true} myTurn={true} onOpenUnseenTiles={() => {}} />
          <BoardViewport>
            <Board board={EMPTY_BOARD} pending={[]} interactive={false} />
          </BoardViewport>
        </div>
        <div className="bottom-bar">
          <div className="rack-area">
            <div className="rack">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="rack-slot" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
