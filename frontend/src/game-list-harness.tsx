// Harness for the game list (GameList.tsx) — sections, game cards, the
// nudge button (hidden-until-allowed cooldown), the rematch button, and the
// nudge fallback dialog/toast. GameList itself needs WorkOS auth + a live
// backend + ElectricSQL, none of which are available in a Claude Code remote
// session, so this drives the real Section component and gameToView view
// model with hand-built mock games instead of the page's data hooks. Not
// part of the app: not imported from main.tsx, not linked from any route.
// `npm run dev` and navigate to /game-list-harness.html. See CLAUDE.md.
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "./theme";
import { gameToView, Section } from "./pages/GameList";
import type { Game } from "./types";
import "./App.css";

const ME = "me";
const NOW = Date.parse("2026-07-20T18:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString();

function makeGame(overrides: Partial<Game>): Game {
  return {
    id: "g1",
    status: "active",
    creator_id: ME,
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
    current_player_id: ME,
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
    creator_last_nudge_at: null,
    opponent_last_nudge_at: null,
    created_at: hoursAgo(48),
    updated_at: hoursAgo(2),
    ...overrides,
  };
}

const GAMES: Game[] = [
  // "Your turn"
  makeGame({ id: "g-your-1", current_player_id: ME, opponent_username: "scottyfischer", opponent_avatar_emoji: "🐝", opponent_avatar_color: "amber-vivid", creator_score: 132, opponent_score: 118 }),
  makeGame({ id: "g-your-2", current_player_id: ME, opponent_username: "clightbo" }),

  // "Their turn": nudgeable now (idle > 1h, no prior nudge).
  makeGame({ id: "g-theirs-nudgeable", current_player_id: "them", updated_at: hoursAgo(3), creator_score: 90, opponent_score: 95 }),
  // "Their turn": still within the 1h idle gate -> button hidden.
  makeGame({ id: "g-theirs-too-soon", current_player_id: "them", updated_at: hoursAgo(0.25), opponent_username: "scottyfischer", opponent_avatar_emoji: "🐝", opponent_avatar_color: "amber-vivid" }),
  // "Their turn": idle long enough, but I nudged 1h ago -> still on cooldown, hidden.
  makeGame({ id: "g-theirs-cooldown", current_player_id: "them", updated_at: hoursAgo(6), creator_last_nudge_at: hoursAgo(1), opponent_username: "mkchen", opponent_avatar_emoji: "🦉", opponent_avatar_color: "violet-vivid" }),

  // "Finished"
  makeGame({ id: "g-fin-win", status: "finished", current_player_id: null, winner_id: ME, creator_score: 401, opponent_score: 355 }),
  makeGame({ id: "g-fin-loss", status: "finished", current_player_id: null, winner_id: "them", opponent_username: "scottyfischer", opponent_avatar_emoji: "🐝", opponent_avatar_color: "amber-vivid", creator_score: 280, opponent_score: 333 }),
  makeGame({ id: "g-fin-draw", status: "finished", current_player_id: null, winner_id: null, opponent_username: "mkchen", opponent_avatar_emoji: "🦉", opponent_avatar_color: "violet-vivid", creator_score: 300, opponent_score: 300 }),
];

// Rematch/nudge only render when the harness passes an onRematch/onNudge
// handler *and* the view says it's eligible -- rematchable needs the
// opponent in the friends set (same gate as the real page).
const FRIEND_IDS = new Set(["them", "scottyfischer"]);

function Harness() {
  const [log, setLog] = useState<string[]>([]);
  const [rematching, setRematching] = useState<string | null>(null);
  const [nudging, setNudging] = useState<string | null>(null);

  const views = useMemo(() => GAMES.map((g) => gameToView(g, ME, FRIEND_IDS, NOW)), []);
  const yourTurn = views.filter((v) => v.game.status === "active" && v.myTurn);
  const theirTurn = views.filter((v) => v.game.status === "active" && !v.myTurn);
  const finished = views.filter((v) => v.game.status === "finished");

  function note(msg: string) {
    setLog((l) => [msg, ...l].slice(0, 5));
  }

  return (
    <ThemeProvider>
      <MemoryRouter>
        <div className="app-page">
          <header className="topbar">
            <span className="wordmark wordmark-sm">Wordplay</span>
          </header>
          <div className="content">
            <button className="btn btn-primary btn-lg btn-block">+ New game</button>

            <Section title="Your turn" views={yourTurn} accent />
            <Section
              title="Their turn"
              views={theirTurn}
              nudging={nudging}
              onNudge={(v) => {
                setNudging(v.game.id);
                note(`nudge(${v.game.id})`);
                setTimeout(() => setNudging(null), 600);
              }}
            />
            <Section
              title="Finished"
              views={finished}
              finished
              rematching={rematching}
              onRematch={(v) => {
                setRematching(v.game.id);
                note(`rematch(${v.game.id})`);
                setTimeout(() => setRematching(null), 600);
              }}
            />
          </div>

          <div style={{ position: "fixed", bottom: 8, left: 8, right: 8, font: "11px monospace", opacity: 0.6 }}>
            {log.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        </div>
      </MemoryRouter>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
