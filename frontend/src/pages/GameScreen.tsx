import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { LayoutGroup } from "motion/react";
import { ApiError } from "../api";
import { checkPlacement, isEmpty } from "../engine";
import { useApi, useProfile } from "../profile";
import { useGamesShape, useMovesShape, useRacksShape } from "../shapes";
import type { Game, PendingTile, PlacedTileDto } from "../types";
import { Board } from "../components/Board";
import { BoardViewport } from "../components/BoardViewport";
import { Rack } from "../components/Rack";
import { Spinner } from "../components/Spinner";
import { ScoreBar } from "../components/ScoreBar";
import { BlankPicker } from "../components/BlankPicker";
import { SwapDialog } from "../components/SwapDialog";
import { SharePanel } from "../components/SharePanel";

export function GameScreen() {
  const { id } = useParams<{ id: string }>();
  const profile = useProfile();
  const getApi = useApi();
  const navigate = useNavigate();

  const { data: games } = useGamesShape();
  const { data: racks } = useRacksShape();
  const { data: moves } = useMovesShape(id!);

  const game = useMemo<Game | undefined>(
    () => games?.find((g) => g.id === id),
    [games, id],
  );
  const myRack = useMemo(
    () => racks?.find((r) => r.game_id === id)?.rack ?? "",
    [racks, id],
  );

  const [pending, setPending] = useState<PendingTile[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [order, setOrder] = useState<number[]>([]);
  const [blankFor, setBlankFor] = useState<{ row: number; col: number; rackIndex: number } | null>(null);
  const [swapOpen, setSwapOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset transient move state when the rack changes (i.e. after any move).
  useEffect(() => {
    setPending([]);
    setSelected(null);
    setOrder(Array.from({ length: myRack.length }, (_, i) => i));
  }, [myRack]);

  if (!game) return <Spinner full />;

  const meCreator = game.creator_id === profile.id;
  const myTurn = game.current_player_id === profile.id;
  const finished = game.status === "finished";
  const awaiting = game.status === "awaiting_opponent";
  const usedIndices = new Set(pending.map((p) => p.rackIndex));

  const lastMove = new Set<string>();
  const lastPlay = [...(moves ?? [])].reverse().find((m) => m.move_type === "play");
  if (lastPlay?.tiles) for (const t of lastPlay.tiles) lastMove.add(`${t.row},${t.col}`);

  const placement = checkPlacement(game.board, pending);
  const canPlay = myTurn && !finished && pending.length > 0 && placement.valid && !busy;

  function selectRackTile(index: number) {
    setError(null);
    setSelected((cur) => (cur === index ? null : index));
  }

  function placeOnCell(row: number, col: number) {
    setError(null);
    // Tapping a pending tile removes it.
    const existing = pending.find((p) => p.row === row && p.col === col);
    if (existing) {
      setPending((p) => p.filter((t) => t !== existing));
      return;
    }
    if (selected === null || !isEmpty(game!.board, row, col)) return;
    const letter = myRack[selected];
    if (letter === "?") {
      setBlankFor({ row, col, rackIndex: selected });
    } else {
      setPending((p) => [...p, { row, col, rackIndex: selected, letter, blank: false }]);
    }
    setSelected(null);
  }

  function chooseBlank(letter: string) {
    if (!blankFor) return;
    setPending((p) => [
      ...p,
      { row: blankFor.row, col: blankFor.col, rackIndex: blankFor.rackIndex, letter, blank: true },
    ]);
    setBlankFor(null);
  }

  function recall() {
    setPending([]);
    setSelected(null);
  }

  function shuffle() {
    setOrder((o) => {
      const next = [...o];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      return next;
    });
  }

  async function submitPlay() {
    setBusy(true);
    setError(null);
    try {
      const api = await getApi();
      const tiles: PlacedTileDto[] = pending.map((p) => ({
        row: p.row,
        col: p.col,
        letter: p.letter.toUpperCase(),
        blank: p.blank,
      }));
      const res = await api.play(id!, tiles);
      setPending([]);
      if (res.game_over) navigate(`/games/${id}/summary`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function doPass() {
    if (!confirm("Pass your turn without playing?")) return;
    await runAction((api) => api.pass(id!));
  }

  async function doResign() {
    if (!confirm("Resign this game? Your opponent wins.")) return;
    await runAction((api) => api.resign(id!));
  }

  async function doSwap(letters: string) {
    setSwapOpen(false);
    await runAction((api) => api.swap(id!, letters));
  }

  async function runAction(fn: (api: Awaited<ReturnType<typeof getApi>>) => Promise<{ game_over: boolean }>) {
    setBusy(true);
    setError(null);
    try {
      const api = await getApi();
      const res = await fn(api);
      setPending([]);
      if (res.game_over) navigate(`/games/${id}/summary`);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const orderedRack = order.length === myRack.length ? order : myRack.split("").map((_, i) => i);

  return (
    <div className="app-page game-screen">
      <header className="topbar">
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          ← Games
        </button>
        <span className="wordmark wordmark-sm">Wordplay</span>
        <span />
      </header>

      <ScoreBar game={game} meCreator={meCreator} myTurn={myTurn} />

      <LayoutGroup>
        <div className="board-wrap">
          <BoardViewport>
            <Board
              board={game.board}
              pending={pending}
              lastMove={lastMove}
              interactive={myTurn && !finished}
              onCellClick={placeOnCell}
            />
          </BoardViewport>
        </div>

        {finished ? (
          <div className="game-actions">
            <button className="btn btn-primary btn-block" onClick={() => navigate(`/games/${id}/summary`)}>
              View summary
            </button>
          </div>
        ) : awaiting && game.move_count === 0 && meCreator ? (
          <>
            <RackArea
              rack={myRack}
              order={orderedRack}
              usedIndices={usedIndices}
              selected={selected}
              onSelect={selectRackTile}
              onShuffle={shuffle}
              onRecall={recall}
              provisional={placement.valid ? placement.score : null}
            />
            <div className="game-actions">
              <button className="btn btn-primary" disabled={!canPlay} onClick={submitPlay}>
                Play opening {placement.valid ? `(${placement.score})` : ""}
              </button>
            </div>
            <p className="hint-text">Play your opening word, then invite an opponent.</p>
          </>
        ) : awaiting ? (
          <SharePanel game={game} />
        ) : (
          <>
            <RackArea
              rack={myRack}
              order={orderedRack}
              usedIndices={usedIndices}
              selected={selected}
              onSelect={selectRackTile}
              onShuffle={shuffle}
              onRecall={recall}
              provisional={placement.valid ? placement.score : null}
            />
            <div className="game-actions">
              <button className="btn btn-primary" disabled={!canPlay} onClick={submitPlay}>
                Play {placement.valid && pending.length > 0 ? `(${placement.score})` : ""}
              </button>
              <button className="btn" disabled={!myTurn || busy} onClick={() => setSwapOpen(true)}>
                Swap
              </button>
              <button className="btn" disabled={!myTurn || busy} onClick={doPass}>
                Pass
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={doResign}>
                Resign
              </button>
            </div>
            {!myTurn && <p className="hint-text">Waiting for @{meCreator ? game.opponent_username : game.creator_username}…</p>}
          </>
        )}
      </LayoutGroup>

      {error && <div className="error-banner">{error}</div>}

      {blankFor && <BlankPicker onChoose={chooseBlank} onCancel={() => setBlankFor(null)} />}
      {swapOpen && (
        <SwapDialog
          rack={myRack}
          disabled={game.tiles_remaining < 7}
          onSwap={doSwap}
          onCancel={() => setSwapOpen(false)}
        />
      )}
    </div>
  );
}

function RackArea({
  rack,
  order,
  usedIndices,
  selected,
  onSelect,
  onShuffle,
  onRecall,
  provisional,
}: {
  rack: string;
  order: number[];
  usedIndices: Set<number>;
  selected: number | null;
  onSelect: (i: number) => void;
  onShuffle: () => void;
  onRecall: () => void;
  provisional: number | null;
}) {
  const reordered = order.map((i) => rack[i]).join("");
  const remap = new Map(order.map((orig, pos) => [pos, orig]));
  const usedInDisplay = new Set(
    [...usedIndices].map((orig) => order.indexOf(orig)).filter((i) => i >= 0),
  );
  return (
    <div className="rack-area">
      <Rack
        letters={reordered}
        usedIndices={usedInDisplay}
        selectedIndex={selected === null ? null : order.indexOf(selected)}
        onSelect={(displayIndex) => onSelect(remap.get(displayIndex)!)}
      />
      <div className="rack-controls">
        <button className="btn btn-ghost btn-sm" onClick={onShuffle}>
          Shuffle
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onRecall}>
          Recall
        </button>
        {provisional !== null && <span className="provisional">+{provisional}</span>}
      </div>
    </div>
  );
}

function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === "invalid_words") {
      const words = (e.detail.words as string[] | undefined) ?? [];
      return `Not in dictionary: ${words.join(", ")}`;
    }
    const map: Record<string, string> = {
      not_your_turn: "It's not your turn.",
      first_move_must_cover_center: "Opening move must cover the center star.",
      first_move_too_short: "Opening move needs at least two tiles.",
      not_connected: "Your word must connect to an existing one.",
      gap: "Tiles can't have gaps.",
      not_in_line: "Tiles must be in a single row or column.",
      bag_too_small_to_swap: "Not enough tiles left in the bag to swap.",
    };
    return map[e.code] ?? "That move wasn't allowed.";
  }
  return "Something went wrong.";
}
