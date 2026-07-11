import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "../profile";
import { useFriendsShape } from "../shapes";
import { shareOrCopy } from "../share";
import { Avatar } from "../components/Avatar";
import { Spinner } from "../components/Spinner";
import { Toast } from "../components/Toast";

export function Friends() {
  const getApi = useApi();
  const navigate = useNavigate();
  const { data: friends, isLoading } = useFriendsShape();
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  async function share() {
    const api = await getApi();
    let url = linkUrl;
    if (!url) {
      const res = await api.getFriendLink();
      url = res.url;
      setLinkUrl(url);
    }
    const result = await shareOrCopy({
      title: "Wordplay",
      text: "Add me as a friend on Wordplay!",
      url,
    });
    if (result === "copied") {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function regenerate() {
    if (!window.confirm("Create a new friend link? Your old link will stop working.")) return;
    const api = await getApi();
    const res = await api.regenerateFriendLink();
    setLinkUrl(res.url);
  }

  async function remove(friendId: string, username: string) {
    if (!window.confirm(`Remove @${username} from your friends? This removes you from theirs too.`)) return;
    setRemoving(friendId);
    try {
      const api = await getApi();
      await api.removeFriend(friendId);
      // The friends shape streams the deletion out; no local state to fix up.
    } finally {
      setRemoving(null);
    }
  }

  const sorted = [...(friends ?? [])].sort((a, b) => a.friend_username.localeCompare(b.friend_username));

  return (
    <div className="app-page">
      <header className="topbar">
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          ← Back
        </button>
        <span className="wordmark wordmark-sm">Friends</span>
        <span />
      </header>

      <div className="content">
        <div className="card">
          <h2>Your friend link</h2>
          <p className="muted">
            Anyone who follows your link and signs in becomes your friend — then you can start games with
            each other any time.
          </p>
          <button className="btn btn-primary btn-lg btn-block" onClick={share}>
            Share my friend link
          </button>
          {linkUrl && <p className="invite-url">{linkUrl}</p>}
          {linkUrl && (
            <button className="btn btn-ghost btn-block" onClick={regenerate}>
              Get a new link
            </button>
          )}
        </div>

        {isLoading && <Spinner />}

        {sorted.length > 0 && (
          <section className="game-section">
            <h2 className="section-title">Your friends</h2>
            <div className="friend-rows">
              {sorted.map((f) => (
                <div key={f.friend_id} className="friend-row">
                  <Avatar
                    name={f.friend_username}
                    emoji={f.friend_avatar_emoji}
                    color={f.friend_avatar_color}
                    size={40}
                  />
                  <span className="friend-name">@{f.friend_username}</span>
                  <button
                    className="btn btn-ghost friend-remove"
                    disabled={removing === f.friend_id}
                    onClick={() => remove(f.friend_id, f.friend_username)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {!isLoading && sorted.length === 0 && (
          <p className="empty-state">No friends yet. Share your link to add one!</p>
        )}
      </div>

      {copied && (
        <div className="share-toast-wrap">
          <Toast tone="success">Link copied!</Toast>
        </div>
      )}
    </div>
  );
}
