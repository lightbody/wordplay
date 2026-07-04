import { useShape } from "@electric-sql/react";
import { useAuth } from "@workos-inc/authkit-react";
import { useCallback } from "react";
import { BASE } from "./api";
import type { Game, Move, Rack } from "./types";

// All shapes are proxied through the backend's /shape endpoint (never
// Electric directly) so the server can enforce per-user row filters. The
// fetchClient override attaches the WorkOS bearer token to every long-poll.
function useShapeFetchClient() {
  const { getAccessToken } = useAuth();
  return useCallback(
    async (url: string | URL | Request, options?: RequestInit) => {
      const token = await getAccessToken();
      return fetch(url, {
        ...options,
        headers: {
          ...(options?.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${token}`,
        },
      });
    },
    [getAccessToken],
  );
}

/** All games I'm a participant in. Powers the game list and turn badges. */
export function useGamesShape() {
  const fetchClient = useShapeFetchClient();
  return useShape<Game>({
    url: `${BASE}/shape`,
    params: { view: "games" },
    fetchClient,
  });
}

/** Every rack I own (one row per active game). */
export function useRacksShape() {
  const fetchClient = useShapeFetchClient();
  return useShape<Rack>({
    url: `${BASE}/shape`,
    params: { view: "racks" },
    fetchClient,
  });
}

/** The move history for one game. */
export function useMovesShape(gameId: string) {
  const fetchClient = useShapeFetchClient();
  return useShape<Move>({
    url: `${BASE}/shape`,
    params: { view: "moves", game_id: gameId },
    fetchClient,
  });
}
