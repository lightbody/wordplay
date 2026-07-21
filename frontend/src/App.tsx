import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { ApiError, createApi } from "./api";
import { yourTurnCount } from "./gameList";
import { ProfileContext } from "./profile";
import { useGamesShape } from "./shapes";
import type { Profile } from "./types";
import { Landing } from "./pages/Landing";
import { Onboarding } from "./pages/Onboarding";
import { GameList } from "./pages/GameList";
import { NewGame } from "./pages/NewGame";
import { GameScreen } from "./pages/GameScreen";
import { Summary } from "./pages/Summary";
import { InviteAccept } from "./pages/InviteAccept";
import { FriendAccept } from "./pages/FriendAccept";
import { Friends } from "./pages/Friends";
import { Spinner } from "./components/Spinner";

export default function App() {
  const { isLoading, user } = useAuth();

  if (isLoading) {
    return <Spinner full />;
  }

  return (
    <Routes>
      {/* Invite and friend links resolve their own auth/onboarding flow. */}
      <Route path="/invite/:token" element={<InviteAccept />} />
      <Route path="/friend/:token" element={<FriendAccept />} />
      <Route path="/*" element={user ? <AuthedApp /> : <Landing />} />
    </Routes>
  );
}

function AuthedApp() {
  const { getAccessToken } = useAuth();
  // undefined = loading, null = signed in but not onboarded
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  // Mounted for the whole authenticated session (not just GameList) so the
  // Home Screen app badge stays accurate even while looking at a single
  // game -- e.g. finishing your turn there should clear the badge without
  // needing to navigate back to the list first.
  const { data: games } = useGamesShape();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const api = createApi(await getAccessToken());
        const p = await api.getMe();
        if (!cancelled) setProfile(p);
      } catch (e) {
        if (!cancelled) setProfile(e instanceof ApiError && e.status === 404 ? null : null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getAccessToken]);

  useEffect(() => {
    // games undefined = shape still loading; wait rather than briefly
    // flashing the badge to cleared before the real count is known.
    if (!profile || games === undefined || !("setAppBadge" in navigator)) return;
    const count = yourTurnCount(games, profile.id);
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else navigator.clearAppBadge().catch(() => {});
  }, [games, profile]);

  useEffect(() => {
    // Push-open tracking (a push-freshness signal the nudge flow uses). The
    // service worker marks notification-tap opens two ways: ?src=push on a
    // fresh load/navigation, or a postMessage to an already-running client.
    // Reporting is fire-and-forget — it must never disturb the app.
    const report = () => {
      getAccessToken()
        .then((t) => createApi(t).reportPushOpened())
        .catch(() => {});
    };

    const params = new URLSearchParams(window.location.search);
    if (params.get("src") === "push") {
      params.delete("src");
      const rest = params.toString();
      // replaceState (not the router) strips the param without a navigation;
      // routes only match on pathname, so it never affected routing anyway.
      window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
      report();
    }

    const onMessage = (e: MessageEvent) => {
      if ((e.data as { type?: string } | null)?.type === "push-open") report();
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, [getAccessToken]);

  if (profile === undefined) return <Spinner full />;

  return (
    <ProfileContext.Provider value={{ profile, setProfile }}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={profile ? <GameList /> : <Navigate to="/onboarding" replace />} />
        <Route path="/new" element={profile ? <NewGame /> : <Navigate to="/onboarding" replace />} />
        <Route path="/friends" element={profile ? <Friends /> : <Navigate to="/onboarding" replace />} />
        <Route path="/games/:id" element={profile ? <GameScreen /> : <Navigate to="/onboarding" replace />} />
        <Route path="/games/:id/summary" element={profile ? <Summary /> : <Navigate to="/onboarding" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProfileContext.Provider>
  );
}
