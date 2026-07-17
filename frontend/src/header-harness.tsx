// Persistent harness for the streamlined in-game topbar (icon-only back
// chevron), the redesigned ScoreBar (avatars, active-turn highlight,
// tiles-remaining ring), the unseen-tiles dialog it opens into, and the
// post-move rating feedback (rating chip on the last-move summary, the
// expandable best-plays panel, and the rating flash overlay). GameScreen
// itself needs WorkOS auth + a live backend + ElectricSQL, none of which are
// available in a Claude Code remote session, so this mounts the real
// components with hand-built mock data instead. Not part of the app: not
// imported from main.tsx, not linked from any route. `npm run dev` and
// navigate to /header-harness.html. See CLAUDE.md.
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "motion/react";
import { ThemeProvider } from "./theme";
import { ScoreBar } from "./components/ScoreBar";
import { LastMoveSummary } from "./components/LastMoveSummary";
import { UnseenTiles } from "./components/UnseenTiles";
import { N } from "./engine";
import type { Game, PlayRating, TopMoveDto } from "./types";
import "./App.css";

const EMPTY_BOARD = ".".repeat(N * N);

function makeGame(overrides: Partial<Game>): Game {
  return {
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

const RATINGS: PlayRating[] = ["wow", "great", "good", "meh"];
const RATING_FLASH_LABELS: Record<PlayRating, string> = {
  wow: "WOW!",
  great: "Great!",
  good: "Good",
  meh: "Meh",
};

// Mover-only best-play alternatives (in the app these come from the play
// response, never from sync) — makes the mover's chip expandable.
const TOP_MOVES: TopMoveDto[] = [
  { tiles: [], words: [{ word: "QUIXOTIC", score: 96 }], score: 96, bingo: true },
  { tiles: [], words: [{ word: "TOXIC", score: 44 }, { word: "OX", score: 18 }], score: 62, bingo: false },
  { tiles: [], words: [{ word: "COT", score: 31 }], score: 31, bingo: false },
];

function Harness() {
  const [unseenOpen, setUnseenOpen] = useState(false);
  // The mover's rating state, cycled via the harness controls below; each
  // change also replays the flash overlay exactly as submitPlay would.
  const [rating, setRating] = useState<PlayRating>("wow");
  const [flash, setFlash] = useState<PlayRating | null>(null);
  const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myTurn = makeGame({ current_player_id: "me", tiles_remaining: 82, board: EMPTY_BOARD });
  const theirTurn = makeGame({ current_player_id: "them", tiles_remaining: 12, opponent_username: "scottyfischer" });
  const myRack = "CARDES?";

  function showRating(r: PlayRating) {
    setRating(r);
    setFlash(r);
    if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlash(null), 1500);
  }

  return (
    <ThemeProvider>
      <div className="app-page game-screen">
        <header className="topbar game-header">
          <button className="icon-btn" aria-label="Back to games">
            <span className="chevron-left" />
          </button>
        </header>
        <div className="game-middle">
          <ScoreBar game={myTurn} meCreator={true} myTurn={true} onOpenUnseenTiles={() => setUnseenOpen(true)} />
          {/* Mover's own move: expandable chip (best-plays panel on tap). */}
          <LastMoveSummary
            summary={{ mine: true, word: "QUIXOTIC", points: 42, rating, moveId: `m-${rating}` }}
            topMoves={TOP_MOVES}
          />
          <div style={{ height: 1, background: "var(--border-subtle)" }} />
          <ScoreBar game={theirTurn} meCreator={true} myTurn={false} onOpenUnseenTiles={() => setUnseenOpen(true)} />
          {/* Opponent's move as synced: rated chip, but inert (no alternatives). */}
          <LastMoveSummary summary={{ mine: false, word: "ZEBRA", points: 18, rating: "great", moveId: "m2" }} />
          <div style={{ height: 1, background: "var(--border-subtle)" }} />
          {/* Pre-feature move rows have no rating: no chip. */}
          <LastMoveSummary summary={{ mine: false, word: "LEGACY", points: 9, rating: null, moveId: "m3" }} />

          <AnimatePresence>
            {flash && (
              <motion.div
                key={flash}
                className={`rating-flash rating-flash-${flash}`}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.08 }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
              >
                <span className="rating-flash-text">{RATING_FLASH_LABELS[flash]}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Harness-only controls: cycle the mover's rating + replay the flash. */}
        <div style={{ display: "flex", gap: 8, padding: 12, justifyContent: "center" }}>
          {RATINGS.map((r) => (
            <button key={r} className="btn" data-rating={r} onClick={() => showRating(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>
      {unseenOpen && <UnseenTiles board={myTurn.board} rack={myRack} onClose={() => setUnseenOpen(false)} />}
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
