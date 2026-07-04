import { createContext, useContext } from "react";
import { useAuth } from "@workos-inc/authkit-react";
import { createApi } from "./api";
import type { Profile } from "./types";

interface ProfileCtx {
  profile: Profile | null;
  setProfile: (p: Profile) => void;
}

export const ProfileContext = createContext<ProfileCtx>({
  profile: null,
  setProfile: () => {},
});

export function useProfile(): Profile {
  const { profile } = useContext(ProfileContext);
  if (!profile) throw new Error("useProfile used outside an onboarded context");
  return profile;
}

export function useProfileContext() {
  return useContext(ProfileContext);
}

/** Build an authed API client bound to a freshly fetched access token. */
export function useApi() {
  const { getAccessToken } = useAuth();
  return async () => createApi(await getAccessToken());
}
