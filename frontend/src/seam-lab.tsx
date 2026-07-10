// TEMPORARY diagnostic page ("seam lab") for the iOS-Safari-only white seam
// between adjacent board tiles. Not part of the app (no route links here);
// it IS included in the production build (see vite.config.ts rollupOptions)
// so it can be opened on a real iPhone from the PR preview deploy, where the
// bug actually reproduces -- it has never reproduced in desktop/CI Chromium.
//
// Each panel renders the same crossword cluster with ONE rendering variable
// changed, labeled A-G. A single phone screenshot of this page answers which
// mechanism is responsible for the seam and which candidate fix works, in
// one round trip instead of one deploy-and-test cycle per theory.
//
// Delete this file (plus seam-lab.html and the vite.config.ts input entry)
// once the root cause is confirmed and fixed.
import { createRoot } from "react-dom/client";
import { N } from "./engine";
import { Board } from "./components/Board";
import { BoardViewport } from "./components/BoardViewport";
import "./App.css";

// Same GODS/SOD/GUSTY/GAY cluster as the original bug report (and the
// drag-harness "seams" scenario).
const SEAM_BOARD = (() => {
  const cells = ".".repeat(N * N).split("");
  const place = (row: number, col: number, letter: string) => {
    cells[row * N + col] = letter;
  };
  place(7, 6, "G");
  place(7, 7, "O");
  place(7, 8, "D");
  place(7, 9, "S");
  place(8, 6, "A");
  place(9, 6, "Y");
  place(6, 7, "S");
  place(8, 7, "D");
  place(5, 9, "G");
  place(6, 9, "U");
  place(8, 9, "T");
  place(9, 9, "Y");
  return cells.join("");
})();

// Per-panel CSS overrides. Inline tile styles (TILE_BLEED_STYLE) need
// !important to be beaten from a stylesheet.
const LAB_CSS = `
  .lab-page {
    max-width: 430px;
    margin: 0 auto;
    padding: 12px 12px 64px;
    font-family: -apple-system, system-ui, sans-serif;
    color: #222;
    background: #faf6ee;
  }
  .lab-page h1 { font-size: 20px; margin: 0 0 4px; }
  .lab-page > p { font-size: 13px; margin: 0 0 20px; line-height: 1.4; }
  .lab-panel { margin: 0 0 28px; }
  .lab-panel h2 {
    font-size: 15px;
    margin: 0 0 2px;
    background: #222;
    color: #fff;
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
  }
  .lab-panel p { font-size: 12px; margin: 2px 0 8px; line-height: 1.35; color: #555; }

  /* C: strip the container query off every tile. cq units would fall back
   * to viewport units without a container, so pin the font sizes too. */
  .lab-no-cq .tile { container-type: normal !important; }
  .lab-no-cq .tile-letter { font-size: 18px !important; }
  .lab-no-cq .tile-value { font-size: 9px !important; }

  /* D: same bleed geometry, but expressed as an explicit width/height plus
   * top/left offset instead of a four-sided negative inset. */
  .lab-size-bleed .tile-small {
    inset: auto !important;
    top: -3px !important;
    left: -3px !important;
    width: calc(100% + 6px) !important;
    height: calc(100% + 6px) !important;
  }

  /* G: no geometric bleed at all -- the tile stays exactly cell-sized and a
   * 3px spread box-shadow in the tile's own color paints the halo over the
   * grid gap instead. Shadows follow the tile's border-radius, so rounded
   * word-end corners stay rounded and squared interior corners stay square. */
  .lab-shadow-bleed .tile-small {
    inset: 0 !important;
    box-shadow: 0 0 0 3px var(--tile-board) !important;
  }
`;

/** A fixed window cropped onto the interesting cluster of a full-size Board,
 * so tiles render ~55px without any transform (transforms are one of the
 * variables under test, so the crop must not introduce one). */
function CroppedBoard({ labClass }: { labClass?: string }) {
  return (
    <div
      className={labClass}
      style={{ width: 360, height: 300, overflow: "hidden", position: "relative" }}
    >
      <div style={{ position: "absolute", top: -300, left: -330, width: 900, height: 900 }}>
        <Board board={SEAM_BOARD} pending={[]} />
      </div>
    </div>
  );
}

// Hand-rolled 3x4 mini board using the same CSS classes and the same inline
// negative-inset bleed as the real Board, but with a configurable element
// tag -- isolates "is it the <button>-inside-<button> markup?" from
// everything else. null = empty cell.
const MINI: (string | null)[][] = [
  [null, "S", null, null],
  ["G", "O", "D", "S"],
  [null, "D", null, null],
];

function MiniBoard({ tag }: { tag: "div" | "button" }) {
  const CellTag = tag;
  const TileTag = tag;
  const has = (r: number, c: number) => !!MINI[r]?.[c];
  const cells = [];
  for (let r = 0; r < MINI.length; r++) {
    for (let c = 0; c < MINI[r].length; c++) {
      const letter = MINI[r][c];
      const squareTL = letter ? has(r, c - 1) || has(r - 1, c) : false;
      const squareBR = letter ? has(r, c + 1) || has(r + 1, c) : false;
      cells.push(
        <CellTag key={`${r},${c}`} className="cell">
          {letter && (
            <TileTag
              className={[
                "tile",
                "tile-board",
                "tile-small",
                squareTL ? "tile-square-tl" : "",
                squareBR ? "tile-square-br" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ position: "absolute", top: -3, right: -3, bottom: -3, left: -3 }}
            >
              <span className="tile-letter">{letter}</span>
            </TileTag>
          )}
        </CellTag>,
      );
    }
  }
  return (
    <div
      className="board"
      style={{ gridTemplateColumns: "repeat(4, 1fr)", width: 300, height: "auto" }}
    >
      {cells}
    </div>
  );
}

function Panel({ id, title, note, children }: { id: string; title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="lab-panel">
      <h2>
        {id} — {title}
      </h2>
      <p>{note}</p>
      {children}
    </div>
  );
}

function Lab() {
  return (
    <div className="lab-page">
      <style>{LAB_CSS}</style>
      <h1>Seam lab</h1>
      <p>
        Every panel shows the same words rendered slightly differently. For each panel A–G, note
        whether the thin white/gray lines BETWEEN touching letter tiles are visible. Screenshot the
        whole page (scroll for all panels).
      </p>
      <Panel id="A" title="Real board, as shipped" note="Control — expected to show the seam.">
        <CroppedBoard />
      </Panel>
      <Panel
        id="B"
        title="Real board inside the zoom viewport"
        note="Same as the game screen, including its transform layer. Pinch this board itself to zoom, then check seams while zoomed."
      >
        <div style={{ width: 360, height: 360, display: "flex" }}>
          <BoardViewport>
            <Board board={SEAM_BOARD} pending={[]} />
          </BoardViewport>
        </div>
      </Panel>
      <Panel
        id="C"
        title="No container query on tiles"
        note="If A shows seams and C doesn't, container-type on .tile is the culprit."
      >
        <CroppedBoard labClass="lab-no-cq" />
      </Panel>
      <Panel
        id="D"
        title="Bleed via explicit size instead of negative inset"
        note="Same geometry as A, computed differently. If A shows seams and D doesn't, Safari mis-resolves inset-derived sizes."
      >
        <CroppedBoard labClass="lab-size-bleed" />
      </Panel>
      <Panel
        id="E"
        title="Mini board, plain divs"
        note="Hand-rolled copy, no button elements anywhere."
      >
        <MiniBoard tag="div" />
      </Panel>
      <Panel
        id="F"
        title="Mini board, nested buttons"
        note="Identical to E but with the real markup's button-inside-button. If F shows seams and E doesn't, it's the button elements."
      >
        <MiniBoard tag="button" />
      </Panel>
      <Panel
        id="G"
        title="Box-shadow halo instead of geometric bleed"
        note="Candidate fix: tiles stay exactly cell-sized; a same-color shadow covers the gap. If this one is seam-free it's the fix."
      >
        <CroppedBoard labClass="lab-shadow-bleed" />
      </Panel>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Lab />);
