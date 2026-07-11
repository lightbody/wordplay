import type { Game, Move, PlacedTileDto, Profile } from "./types";

// Electric's ShapeStream requires an absolute URL — use origin+/api in dev,
// or the explicit VITE_API_URL in production.
export const BASE =
  import.meta.env.VITE_API_URL !== undefined
    ? import.meta.env.VITE_API_URL
    : `${window.location.origin}/api`;

export class ApiError extends Error {
  status: number;
  code: string;
  detail: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.error ?? `${status}`));
    this.status = status;
    this.code = String(body.error ?? "error");
    this.detail = body;
  }
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...init,
  });
  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = await res.json();
    } catch {
      body = { error: res.statusText };
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface GameDetail {
  game: Game;
  rack: string | null;
  moves: Move[];
}

export function createApi(token: string) {
  return {
    getMe: () => request<Profile>("/me", token),

    createMe: (username: string) =>
      request<Profile>("/me", token, {
        method: "POST",
        body: JSON.stringify({ username }),
      }),

    checkUsername: (username: string) =>
      request<{ available: boolean; reason?: string }>(`/usernames/${encodeURIComponent(username)}`, token),

    updateAvatar: (emoji: string, color: string) =>
      request<Profile>("/me", token, {
        method: "PATCH",
        body: JSON.stringify({ avatar_emoji: emoji, avatar_color: color }),
      }),

    createGame: (deductUnused: boolean) =>
      request<{ game: Game; rack: string }>("/games", token, {
        method: "POST",
        body: JSON.stringify({ deduct_unused: deductUnused }),
      }),

    getGame: (id: string) => request<GameDetail>(`/games/${id}`, token),

    play: (id: string, tiles: PlacedTileDto[]) =>
      request<{ game: Game; move: Move; rack: string; game_over: boolean }>(`/games/${id}/moves`, token, {
        method: "POST",
        body: JSON.stringify({ type: "play", tiles }),
      }),

    swap: (id: string, letters: string) =>
      request<{ game: Game; rack: string; game_over: boolean }>(`/games/${id}/moves`, token, {
        method: "POST",
        body: JSON.stringify({ type: "swap", letters }),
      }),

    pass: (id: string) =>
      request<{ game: Game; game_over: boolean }>(`/games/${id}/moves`, token, {
        method: "POST",
        body: JSON.stringify({ type: "pass" }),
      }),

    resign: (id: string) =>
      request<{ game: Game; game_over: boolean }>(`/games/${id}/moves`, token, {
        method: "POST",
        body: JSON.stringify({ type: "resign" }),
      }),

    challenge: (id: string, username: string) =>
      request<Game>(`/games/${id}/challenge`, token, {
        method: "POST",
        body: JSON.stringify({ username }),
      }),

    createInvite: (id: string) =>
      request<{ token: string; url: string }>(`/games/${id}/invites`, token, { method: "POST" }),

    acceptInvite: (inviteToken: string) =>
      request<{ game_id: string }>(`/invites/${inviteToken}/accept`, token, { method: "POST" }),
  };
}
