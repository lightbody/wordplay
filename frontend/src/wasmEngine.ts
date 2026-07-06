// Loads the wasm-compiled word-validation engine (shared Rust logic, see
// wasm-engine/) and the dictionary it needs. Kicked off once at app boot
// (see main.tsx) and never blocks initial render -- everything here is
// fire-and-forget until a consumer calls checkPlacementWasm/useEngineStatus.

import { useSyncExternalStore } from "react";
import type { PendingTile, PlacedTileDto } from "./types";

export type EngineStatus = "loading" | "ready" | "unavailable";

export interface WordResult {
  text: string;
  cells: Array<[number, number]>;
}

export interface CheckResult {
  valid: boolean;
  code: string | null;
  invalid_words: string[];
  score: number;
  bingo: boolean;
  words: WordResult[];
}

type WasmModule = typeof import("./generated/wasm-engine/wordplay_wasm");

let status: EngineStatus = "loading";
let wasmMod: WasmModule | null = null;
let loadPromise: Promise<void> | null = null;

const listeners = new Set<() => void>();
function notify() {
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function engineStatus(): EngineStatus {
  return status;
}

export function useEngineStatus(): EngineStatus {
  return useSyncExternalStore(subscribe, engineStatus);
}

/** Fire-and-forget; safe to call multiple times (returns the same promise). */
export function loadEngine(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const [mod, dictResponse] = await Promise.all([
        import("./generated/wasm-engine/wordplay_wasm"),
        fetch(new URL("./generated/dictionary.txt", import.meta.url)),
      ]);
      await mod.default();
      const dictBytes = new Uint8Array(await dictResponse.arrayBuffer());
      mod.init_dictionary(dictBytes);
      wasmMod = mod;
      status = "ready";
    } catch (err) {
      // Falls back to structural-only gating (see GameScreen.tsx); this is
      // not fatal, just a lost optimization (blocked script, unsupported
      // browser, etc).
      console.error("Word-validation engine failed to load; falling back to structural-only checks.", err);
      status = "unavailable";
    }
    notify();
  })();
  return loadPromise;
}

export function toWireTile(t: PendingTile): PlacedTileDto {
  return { row: t.row, col: t.col, letter: t.letter.toUpperCase(), blank: t.blank };
}

export function checkPlacementWasm(board: string, rack: string, tiles: PlacedTileDto[]): CheckResult | null {
  if (status !== "ready" || !wasmMod) return null;
  return JSON.parse(wasmMod.check_placement(board, rack, JSON.stringify(tiles))) as CheckResult;
}
