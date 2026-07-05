import { useAuth } from "@workos-inc/authkit-react";

export function Landing() {
  const { signIn } = useAuth();
  return (
    <div className="landing">
      <div className="landing-card">
        <h1 className="wordmark">Wordplay</h1>
        <p className="tagline">A delightful word game for two.</p>
        <button className="btn btn-primary btn-lg" onClick={() => signIn()}>
          Sign in to play
        </button>
      </div>
    </div>
  );
}
