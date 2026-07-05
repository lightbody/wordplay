import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@workos-inc/authkit-react";
import { ApiError, createApi } from "./api";
import { ProfileContext } from "./profile";
import type { Profile } from "./types";
import { Landing } from "./pages/Landing";
import { Onboarding } from "./pages/Onboarding";
import { GameList } from "./pages/GameList";
import { NewGame } from "./pages/NewGame";
import { GameScreen } from "./pages/GameScreen";
import { Summary } from "./pages/Summary";
import { InviteAccept } from "./pages/InviteAccept";
import { Spinner } from "./components/Spinner";

export default function App() {
  const { isLoading, user } = useAuth();

  if (isLoading) {
    return <Spinner full />;
  }

  return (
    <Routes>
      {/* Invite links resolve their own auth/onboarding flow. */}
      <Route path="/invite/:token" element={<InviteAccept />} />
      <Route path="/*" element={user ? <AuthedApp /> : <Landing />} />
    </Routes>
  );
}

function AuthedApp() {
  const { getAccessToken } = useAuth();
  // undefined = loading, null = signed in but not onboarded
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);

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

  if (profile === undefined) return <Spinner full />;

  return (
    <ProfileContext.Provider value={{ profile, setProfile }}>
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/" element={profile ? <GameList /> : <Navigate to="/onboarding" replace />} />
        <Route path="/new" element={profile ? <NewGame /> : <Navigate to="/onboarding" replace />} />
        <Route path="/games/:id" element={profile ? <GameScreen /> : <Navigate to="/onboarding" replace />} />
        <Route path="/games/:id/summary" element={profile ? <Summary /> : <Navigate to="/onboarding" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ProfileContext.Provider>
  );
}
