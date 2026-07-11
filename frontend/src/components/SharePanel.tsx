import { useState } from "react";
import { useApi } from "../profile";
import { shareOrCopy } from "../share";
import type { Game } from "../types";
import { Toast } from "./Toast";

export function SharePanel({ game }: { game: Game }) {
  const getApi = useApi();
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function share() {
    const api = await getApi();
    let url = inviteUrl;
    if (!url) {
      const res = await api.createInvite(game.id);
      url = res.url;
      setInviteUrl(url);
    }
    const result = await shareOrCopy({
      title: "Wordplay",
      text: "I challenged you to a game of Wordplay!",
      url,
    });
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="share-panel">
      <div className="card">
        <h3>Invite an opponent</h3>
        <p className="muted">
          Send the link to anyone — when they join, the game starts and they're added to your friends.
        </p>
        <button className="btn btn-primary btn-lg btn-block" onClick={share}>
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
