import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useApi, useProfileContext } from "../profile";

const PENDING_INVITE_KEY = "wordplay:pendingInvite";
const PENDING_FRIEND_KEY = "wordplay:pendingFriend";

export function Onboarding() {
  const getApi = useApi();
  const navigate = useNavigate();
  const { setProfile } = useProfileContext();
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "available" | "taken" | "invalid">("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<number>();

  // Always call the latest getApi without making it an effect dependency:
  // useApi() (like most hook factories) may return a new function identity
  // on renders unrelated to the username field, and including it in the
  // deps array below would re-run the debounce on every such render —
  // perpetually resetting status back to "checking" right as it resolves.
  const getApiRef = useRef(getApi);
  useEffect(() => {
    getApiRef.current = getApi;
  }, [getApi]);

  useEffect(() => {
    window.clearTimeout(debounce.current);
    const trimmed = username.trim();
    if (trimmed.length < 3) {
      setStatus(trimmed.length === 0 ? "idle" : "invalid");
      return;
    }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(trimmed)) {
      setStatus("invalid");
      return;
    }
    setStatus("checking");
    debounce.current = window.setTimeout(async () => {
      try {
        const api = await getApiRef.current();
        const res = await api.checkUsername(trimmed);
        setStatus(res.available ? "available" : "taken");
      } catch {
        setStatus("idle");
      }
    }, 350);
    return () => window.clearTimeout(debounce.current);
  }, [username]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const api = await getApi();
      const profile = await api.createMe(username.trim());
      setProfile(profile);
      const pendingInvite = sessionStorage.getItem(PENDING_INVITE_KEY);
      const pendingFriend = sessionStorage.getItem(PENDING_FRIEND_KEY);
      if (pendingInvite) {
        sessionStorage.removeItem(PENDING_INVITE_KEY);
        navigate(`/invite/${pendingInvite}`, { replace: true });
      } else if (pendingFriend) {
        sessionStorage.removeItem(PENDING_FRIEND_KEY);
        navigate(`/friend/${pendingFriend}`, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === "username_taken") {
        setStatus("taken");
      } else {
        setError("Something went wrong. Please try again.");
      }
      setSubmitting(false);
    }
  }

  const canSubmit = status === "available" && !submitting;

  return (
    <div className="centered-page">
      <form className="card onboarding" onSubmit={submit}>
        <h1 className="wordmark">Wordplay</h1>
        <p>Pick a username. This is how friends will challenge you.</p>
        <div className="field">
          <input
            autoFocus
            className="input"
            placeholder="username"
            value={username}
            maxLength={20}
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
          />
          <div className={`hint hint-${status}`}>
            {status === "checking" && "Checking…"}
            {status === "available" && "✓ Available"}
            {status === "taken" && "Already taken"}
            {status === "invalid" && "3–20 letters, numbers, or underscores"}
          </div>
        </div>
        {error && <div className="error-banner">{error}</div>}
        <button className="btn btn-primary btn-lg" disabled={!canSubmit}>
          {submitting ? "Saving…" : "Continue"}
        </button>
      </form>
    </div>
  );
}
