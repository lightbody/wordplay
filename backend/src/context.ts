import type { KeyLike } from "jose";
import type { Pool } from "pg";
import type { Dictionary } from "@wordplay/shared";

/** State shared across every request. Ported from backend/src/lib.rs's AppState. */
export interface AppContext {
  pool: Pool;
  /** WorkOS JWKS, fetched once at boot and never refreshed (see auth.ts). */
  jwks: Map<string, KeyLike>;
  electricUrl: string;
  publicAppUrl: string;
  dictionary: Dictionary;
  dictionaryText: string;
  dictionaryHash: string;
  dictionarySize: number;
  dictionaryWordCount: number;
  /** Not secret — the client needs it to call pushManager.subscribe(). */
  vapidPublicKey: string;
}
