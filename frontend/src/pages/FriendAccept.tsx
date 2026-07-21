import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { ApiError, BASE, createApi } from "../api";
import { saveReturnPath } from "../authReturn";
import { Spinner } from "../components/Spinner";

const PENDING_FRIEND_KEY = "wordplay:pendingFriend";

interface Preview {
  username: string;
  avatar_emoji: string;
  avatar_color: string;
}

/** Landing page for a personal friend link (/friend/:token). */
export function FriendAccept() {
  const { token } = useParams<{ token: string }>();
  const { isLoading, user, signIn, getAccessToken } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Public preview for the signed-out hero (no auth required).
  useEffect(() => {
    fetch(`${BASE}/friends/${token}/preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [token]);

  // Once signed in, resolve onboarding then accept the friendship.
  useEffect(() => {
    if (isLoading || !user || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const api = createApi(await getAccessToken());
        try {
          await api.getMe();
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) {
            sessionStorage.setItem(PENDING_FRIEND_KEY, token);
            navigate("/onboarding", { replace: true });
            return;
          }
          throw e;
        }
        await api.acceptFriend(token);
        if (!cancelled) navigate("/friends", { replace: true });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "cannot_friend_self") {
          navigate("/friends", { replace: true });
        } else {
          setError("We couldn't open this friend link. It may have been replaced with a newer one.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoading, user, token, getAccessToken, navigate]);

  if (isLoading) return <Spinner full />;

  if (user) {
    return error ? (
      <div className="centered-page">
        <div className="card">
          <p>{error}</p>
          <button className="btn btn-primary" onClick={() => navigate("/")}>
            Go to my games
          </button>
        </div>
      </div>
    ) : (
      <Spinner full />
    );
  }

  // Signed-out hero.
  const inviter = preview?.username;
  return (
    <div className="landing">
      <div className="landing-card">
        <h1 className="wordmark">Wordplay</h1>
        <p className="tagline">
          {inviter
            ? `@${inviter} wants to play Wordplay with you!`
            : "You've been invited to Wordplay!"}
        </p>
        <p className="invite-first-word">Sign in to add them as a friend and start a game.</p>
        <button
          className="btn btn-primary btn-lg"
          onClick={() => {
            if (token) sessionStorage.setItem(PENDING_FRIEND_KEY, token);
            saveReturnPath();
            signIn();
          }}
        >
          Sign up & play
        </button>
      </div>
    </div>
  );
}
