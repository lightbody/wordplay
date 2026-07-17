import type { KeyLike } from "jose";
import type { Pool } from "pg";
import type { Dictionary, Trie } from "@wordplay/shared";

/** State shared across every request. Ported from backend/src/lib.rs's AppState. */
export interface AppContext {
  pool: Pool;
  /** WorkOS JWKS, fetched once at boot and never refreshed (see auth.ts). */
  jwks: Map<string, KeyLike>;
  electricUrl: string;
  publicAppUrl: string;
  dictionary: Dictionary;
  /** Prefix structure over the same word list, for the best-move solver. */
  wordTrie: Trie;
  dictionaryText: string;
  dictionaryHash: string;
  dictionarySize: number;
  dictionaryWordCount: number;
  /** Not secret — the client needs it to call pushManager.subscribe(). */
  vapidPublicKey: string;
}
