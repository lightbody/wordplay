import { useState } from "react";
import { ApiError } from "../api";
import { useApi } from "../profile";
import type { Game } from "../types";
import { Toast } from "./Toast";

export function SharePanel({ game }: { game: Game }) {
  const getApi = useApi();
  const [username, setUsername] = useState("");
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const [challenging, setChallenging] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function challenge(e: React.FormEvent) {
    e.preventDefault();
    setChallenging(true);
    setChallengeError(null);
    try {
      const api = await getApi();
      await api.challenge(game.id, username.trim());
      // The games shape will stream the now-active game back in.
    } catch (err) {
      if (err instanceof ApiError) {
        const map: Record<string, string> = {
          not_found: "No player with that username.",
          cannot_challenge_self: "You can't challenge yourself.",
          already_has_opponent: "This game already has an opponent.",
        };
        setChallengeError(map[err.code] ?? "Couldn't send the challenge.");
      }
      setChallenging(false);
    }
  }

  async function share() {
    const api = await getApi();
    let url = inviteUrl;
    if (!url) {
      const res = await api.createInvite(game.id);
      url = res.url;
      setInviteUrl(url);
    }
    const shareData = {
      title: "Wordplay",
      text: "I challenged you to a game of Wordplay!",
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        /* user cancelled */
      }
    } else {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="share-panel">
      <div className="card">
        <h3>Invite an opponent</h3>
        <form className="challenge-form" onSubmit={challenge}>
          <input
            className="input"
            placeholder="Challenge by username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
          />
          <button className="btn btn-primary" disabled={username.trim().length < 3 || challenging}>
            Challenge
          </button>
        </form>
        {challengeError && <div className="error-inline">{challengeError}</div>}

        <div className="or-divider">or</div>

        <button className="btn btn-lg btn-block" onClick={share}>
          Share invite link
        </button>
        {inviteUrl && <p className="invite-url">{inviteUrl}</p>}
      </div>
      {copied && (
        <div className="share-toast-wrap">
          <Toast tone="success">Link copied!</Toast>
        </div>
      )}
    </div>
  );
}
