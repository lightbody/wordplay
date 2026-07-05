import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { ApiError, BASE, createApi } from "../api";
import { Spinner } from "../components/Spinner";

const PENDING_INVITE_KEY = "wordplay:pendingInvite";

interface Preview {
  inviter_username: string;
  first_word: string | null;
}

export function InviteAccept() {
  const { token } = useParams<{ token: string }>();
  const { isLoading, user, signIn, getAccessToken } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Public preview for the signed-out hero (no auth required).
  useEffect(() => {
    fetch(`${BASE}/invites/${token}/preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [token]);

  // Once signed in, resolve onboarding then accept the invite.
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
            sessionStorage.setItem(PENDING_INVITE_KEY, token);
            navigate("/onboarding", { replace: true });
            return;
          }
          throw e;
        }
        const { game_id } = await api.acceptInvite(token);
        if (!cancelled) navigate(`/games/${game_id}`, { replace: true });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === "already_claimed") {
          setError("This invite has already been used by someone else.");
        } else if (e instanceof ApiError && e.code === "cannot_accept_own_invite") {
          navigate("/", { replace: true });
        } else {
          setError("We couldn't open this invite. It may have expired.");
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
  const inviter = preview?.inviter_username;
  return (
    <div className="landing">
      <div className="landing-card">
        <h1 className="wordmark">Wordplay</h1>
        <p className="tagline">
          {inviter ? `@${inviter} challenged you to Wordplay!` : "You've been challenged to Wordplay!"}
        </p>
        {preview?.first_word && (
          <p className="invite-first-word">
            They opened with <strong>{preview.first_word}</strong> — your move.
          </p>
        )}
        <button
          className="btn btn-primary btn-lg"
          onClick={() => {
            if (token) sessionStorage.setItem(PENDING_INVITE_KEY, token);
            signIn();
          }}
        >
          Sign up & play
        </button>
      </div>
    </div>
  );
}
