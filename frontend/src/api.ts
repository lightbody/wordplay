import type { Game, Move, PlacedTileDto, Profile, TopMoveDto } from "./types";

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
      // Only declare a JSON body when we're actually sending one -- Fastify's
      // JSON body parser rejects a request that claims Content-Type:
      // application/json but has an empty body (e.g. the bodyless POST/DELETE
      // calls like acceptFriend/removeFriend/createInvite), even though no
      // body was intended.
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
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

/** The nudged opponent's push health, for the share-sheet backup decision. */
export interface OpponentPush {
  subscriptions: number;
  last_signal_at: string | null;
  likely_receiving: boolean;
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

    createGame: (deductUnused: boolean, friendId?: string) =>
      request<{ game: Game; rack: string }>("/games", token, {
        method: "POST",
        body: JSON.stringify({ deduct_unused: deductUnused, friend_id: friendId }),
      }),

    getGame: (id: string) => request<GameDetail>(`/games/${id}`, token),

    play: (id: string, tiles: PlacedTileDto[]) =>
      request<{ game: Game; move: Move; rack: string; game_over: boolean; top_moves?: TopMoveDto[] }>(`/games/${id}/moves`, token, {
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

    nudge: (id: string) =>
      request<{ game: Game; opponent_push: OpponentPush }>(`/games/${id}/nudge`, token, { method: "POST" }),

    createInvite: (id: string) =>
      request<{ token: string; url: string }>(`/games/${id}/invites`, token, { method: "POST" }),

    acceptInvite: (inviteToken: string) =>
      request<{ game_id: string }>(`/invites/${inviteToken}/accept`, token, { method: "POST" }),

    getVapidPublicKey: () => request<{ public_key: string }>("/push/vapid-public-key", token),

    subscribePush: (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
      request<void>("/me/push-subscriptions", token, {
        method: "POST",
        body: JSON.stringify(subscription),
      }),

    unsubscribePush: (endpoint: string) =>
      request<void>("/me/push-subscriptions", token, {
        method: "DELETE",
        body: JSON.stringify({ endpoint }),
      }),

    reportPushOpened: () => request<void>("/me/push-opened", token, { method: "POST" }),

    getFriendLink: () => request<{ token: string; url: string }>("/friends/link", token),

    regenerateFriendLink: () =>
      request<{ token: string; url: string }>("/friends/link", token, { method: "POST" }),

    acceptFriend: (friendToken: string) =>
      request<{ friend_id: string; friend_username: string }>(`/friends/${friendToken}/accept`, token, {
        method: "POST",
      }),

    removeFriend: (friendId: string) =>
      request<void>(`/friends/${encodeURIComponent(friendId)}`, token, { method: "DELETE" }),
  };
}
