# Wordplay Frontend Glossary

Shared vocabulary for talking about the UI precisely. When discussing a visual change, use
these terms — they map 1:1 to component names and CSS classes in `frontend/src/`, so using
them lets a developer jump straight to the right file.

This file documents *what things are called*, not how they work. Keep it in sync with the
components: when you rename a component, add a new screen element, or introduce a new piece
of chrome, update the matching entry here in the same change.

## App shell

- **Topbar** (`.topbar`) — the fixed header at the top of every screen. On the game list and
  other pages it holds the **wordmark** (`.wordmark`, "Wordplay" logotype) and the
  **account menu**; on the game screen (`.game-header`) it holds only the **back chevron**
  (`.icon-btn` + `.chevron-left`).
- **Account menu** (`AccountMenu.tsx`, `.account-menu`) — the **avatar** button in the topbar
  that opens a dropdown **panel** (`.account-menu-panel`) with the user's identity, an
  **Edit avatar** row that opens the **avatar editor dialog** (see Dialogs), an
  **appearance/theme segment** (System/Light/Dark, `.theme-segment`), and Sign out.
- **Avatar** (`Avatar.tsx`) — the circular badge used for a player everywhere (topbar, scorebar,
  game cards): a user-chosen **emoji** on a user-chosen **background color**, picked from the
  small curated sets in `shared/src/avatar.ts`. Falls back to a hash-derived initial + color
  (the old scheme) only when a caller has no emoji/color to pass — not expected in normal use.

## Game screen (`GameScreen.tsx`)

Top to bottom, the game screen (`.game-screen`) is laid out as:

1. **Topbar** — back chevron only.
2. **Middle area** (`.game-middle`) — scrollable/flex region holding, in order:
   - **Scorebar** (see below)
   - **Last-move summary** (`LastMoveSummary.tsx`, `.last-move-summary`) — the one-line "You
     played CARDS for 24 points." caption under the scorebar.
   - **Board viewport** (see below)
   - **Share panel**, only during the *sharing* phase (see Phases)
3. **Bottom bar** (`.bottom-bar`) — fixed footer holding the **rack area** and the
   **action bar** (see below). Hidden entirely during the *sharing* phase.

### Phases

`GameScreen` computes a `phase` that governs which bottom-bar controls show:
- **opening** — the game creator's very first move, before an opponent has joined. Action bar
  is just Recall/Shuffle + Play.
- **sharing** — opening move played, no opponent yet; bottom bar is replaced by the
  **share panel**.
- **playing** — normal turn-by-turn play; full action bar (More / Swap / Recall-Shuffle / Play).
- **finished** — game over; bottom bar is a single "View summary" button.

## The board

- **Board viewport** (`BoardViewport.tsx`, `.board-viewport`) — the pinch-zoom/pan *frame*
  around the board. Wraps the board in `.board-wrap`/`.board-surface`; owns double-tap-to-zoom
  and pinch gesture handling. Distinct from the board itself — this is the "camera", not the
  grid.
- **Board** (`Board.tsx`, `.board`) — the 15×15 CSS grid of **cells**.
- **Cell** (`.cell`) — one square of the grid. A cell is empty, holds a **committed tile**
  (already played, from a prior move — lighter blue, `.tile-board`), or holds a **pending
  tile** (placed this turn, not yet submitted — darker blue, `.tile-pending`).
- **Premium square** — a cell with a scoring bonus, laid out in the standard (asymmetric)
  Scrabble pattern (`shared/src/board.ts`'s `premium()`/`LAYOUT`). Four kinds, each with its
  own background color and label chip (`.cell-premium`):
  - **DL** / "2L" (`.cell-dl`) — double letter
  - **TL** / "3L" (`.cell-tl`) — triple letter
  - **DW** / "2W" (`.cell-dw`) — double word
  - **TW** / "3W" (`.cell-tw`) — triple word
  - The **center star** (`.cell-center`, row 7 col 7, ★) is a DW square and the required
    starting square for the opening move.
- **Word fill** / **highlight** (`--word-fill`, green) — the fill painted behind the cells of
  the in-progress pending move once it forms a dictionary-valid word, tracing an outline
  around the whole played word (see `wordOutline.ts`). Referred to as "the green outline/fill".
- **Score badge** (`.board-score-badge`) — the small circular provisional-score indicator
  overlaid on the lowest/rightmost pending tile of the in-flight move. Green with dark text
  (`.board-score-badge-valid`) once the placement is dictionary-valid; dark blue with white
  text (`.board-score-badge-invalid`) otherwise, still showing the potential score. Lives on
  the board rather than the action bar so the **Play** button's label stays short and
  single-line.
- **Drop target** — the cell currently hovered while dragging a tile; styled green
  (`.cell-drop-valid`) if it's a legal empty square or red (`.cell-drop-invalid`) if occupied.

## Tiles & the rack

- **Tile** (`Tile.tsx`, `.tile`) — a single letter tile, used on the rack, on the board, and
  in dialogs (swap picker, drag ghost). Shows the **letter** and, unless it's a blank, its
  **point value** chip (`.tile-value`) in the corner.
- **Blank tile** — a wildcard tile: an empty-faced tile on the rack and, once played, a
  normal-looking tile with no point-value chip (deliberately no other marker). Placing one
  from the rack opens the **blank picker** (see Dialogs) to assign it a letter; it then
  displays that letter but scores 0 points.
- **Rack** (`Rack.tsx`, `.rack`) — the player's row of up to 7 tiles, sitting in the
  **rack area** (`.rack-area`) above the action bar. Individual positions are **rack slots**
  (`.rack-slot`); a slot for a tile that's currently placed on the board (pending) renders as
  an empty gap rather than disappearing, so the row width stays stable.
- **Drag ghost** (`.drag-ghost`) — the enlarged floating copy of a tile that follows the
  pointer/finger while dragging it (rack → board, board → rack, or reordering within the rack).

## Score & status

- **Scorebar** (`ScoreBar.tsx`, `.scorebar`) — the row above the board showing both players.
  Each side is a **player chip** (`.scorebar-player`) with an avatar, `@username`, and score;
  the active (current-turn) player's chip is highlighted (`.scorebar-player.active`). Between
  the two player chips sits the **tiles-left ring** (`.tiles-ring`) — a circular progress
  indicator (drawn down from `BAG_SIZE`) showing how many tiles remain in the bag. Tapping it
  opens the **unseen tiles** dialog (see Dialogs).
- **Last-move summary** — see Game screen above.
- **Badge** (`.badge` on game cards) — small status pill: "Your move", "Waiting", "Invite a
  player", "Draw", "You won"/"You lost".

## Action bar (bottom of the game screen)

The **action bar** (`.game-actions`, the row of buttons at the very bottom) contents depend on
phase. Every non-Play action renders as a compact **secondary action button** (`.action-btn`) — a
small inline-SVG line icon (`components/icons.tsx`) over a caption-sized label, no border/fill
until pressed — so the whole row stays on one line at any width:
- **More** (`MoreIcon`, three dots) — opens the **more menu** dialog (Unseen tiles / Pass /
  Resign).
- **Swap** (`SwapIcon`, offset up/down arrows) — opens the **swap dialog** to exchange rack
  tiles for new ones from the bag.
- **Recall / Shuffle** — a single button that toggles meaning and icon: **Shuffle**
  (`ShuffleIcon`, crossing arrows) randomizes rack tile order when nothing is pending; once
  tiles are placed on the board it becomes **Recall** (`RecallIcon`, a chevron), which pulls all
  pending tiles back to the rack.
- **Play** (`.action-play`, the one primary-styled button, taking the remaining row width) —
  submits the current pending placement as a move. Always reads just "Play" (disabled unless
  `canPlay`), or "Their turn" (disabled) when it isn't the player's turn — the live provisional
  score moved off this button onto the board's **score badge** (see The board, above) so the
  label never wraps to a second line.

## Dialogs & overlays

All of these render on top of a shared **Dialog** (`Dialog.tsx`) — a centered modal **card**
over a dimmed/blurred backdrop, with an optional title and an **actions row** of buttons.

- **Blank picker** (`BlankPicker.tsx`) — "Choose a letter for the blank": an A–Z **letter
  grid** of buttons, shown after dropping a blank tile onto the board.
- **Swap dialog** (`SwapDialog.tsx`) — "Swap tiles": tap tiles in a static row (`.swap-rack`)
  to select 1–7 to exchange for random tiles from the bag; disabled with an explanatory message
  if the bag has fewer than 7 tiles left.
- **More menu** (`MoreMenu.tsx`) — "More actions": an Unseen tiles button, plus Pass and Resign
  (`.modal-action-list`, the latter two each behind their own confirm() prompt).
- **Unseen tiles** (`UnseenTiles.tsx`, `.unseen-tiles-grid`) — "Unseen tiles": every tile not on
  the board and not in this player's own rack (could be in the bag or the opponent's rack),
  grouped by letter as a blue board-style **tile** with a remaining count underneath. Computed
  entirely client-side from `game.board` and the player's own rack (`unseenTiles.ts`) — never
  shared with or computed by the opponent's client or the backend, since what's "unseen" differs
  per player. Opened from the **more menu** or by tapping the **tiles-left ring**.
- **Avatar editor dialog** (`AvatarEditorDialog.tsx`) — "Edit avatar": a large preview circle,
  a grid of selectable emoji (`.avatar-emoji-grid`), and a row of color swatches
  (`.avatar-color-row`), from the sets in `shared/src/avatar.ts`. Opened from the **Edit
  avatar** row in the account menu; Save calls `PATCH /me` and updates the profile everywhere
  the avatar is shown, including on any of the user's in-progress opponents' game screens.
- **Share panel** (`SharePanel.tsx`, `.share-panel`) — not a Dialog, but an inline card shown
  in place of the board during the *sharing* phase: a "Challenge by username" form and a
  "Share invite link" button (native share sheet, or copy-link with a **toast**).
- **Toast** (`Toast.tsx`) — a small pill-shaped transient notification (e.g. "Link copied!").

## Other primitives

- **Switch** (`Switch.tsx`) — a pill-shaped on/off toggle (used for the "deduct unused tile
  values" game option on New Game).
- **Spinner** (`Spinner.tsx`) — three pulsing dots, used inline or full-screen (`.spinner-full`)
  while data loads.

## Pages other than the game screen

- **Landing** (`Landing.tsx`, `.landing`/`.landing-card`) — signed-out marketing/sign-in screen.
- **Onboarding** (`Onboarding.tsx`) — first-run username picker, with live availability
  checking (`.hint-*` states: checking/available/taken/invalid).
- **Game list** (`GameList.tsx`) — the home screen after sign-in. Games are grouped into
  **sections** (`.game-section`: "Your turn", "Their turn", "Waiting for an opponent",
  "Finished"), each a list of **game cards** (`.game-card`) showing the opponent's avatar,
  `vs @username`, the score line, and a status badge.
- **New game** (`NewGame.tsx`) — the pre-game options screen (currently just the "deduct unused
  tile values" switch) before playing the opening move.
- **Invite accept** (`InviteAccept.tsx`) — the landing page reached from a shared invite link,
  with a signed-out "hero" preview of who challenged you and their opening word.
- **Summary** (`Summary.tsx`) — post-game recap: a **result banner** (win/loss/draw), a
  **final scores** row (`.final-scores`, each side a **score column** `.score-col` with label,
  final score, and any unused-tile adjustment), a **scores-over-time chart**, and a
  **stats grid** (`.stats-grid`) of per-player **stat cards** (Best move / Avg move / Lowest /
  Bingos, plus best word).

## Dev-only verification harnesses

Not part of the shipped app — see `CLAUDE.md` for how/when to use these. Each mounts a subset
of the real components above with hand-built mock data:

- `drag-harness.html` — Rack/Board drag-and-drop.
- `zoom-harness.html` — BoardViewport pinch/pan/zoom.
- `header-harness.html` — game-screen topbar + Scorebar.
- `account-menu-harness.html` — AccountMenu dropdown.
