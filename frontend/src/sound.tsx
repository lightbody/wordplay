import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "wordplay-sound-enabled";

function readStoredPreference(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

interface SoundCtx {
  enabled: boolean;
  setEnabled: (e: boolean) => void;
}

export const SoundContext = createContext<SoundCtx>({
  enabled: true,
  setEnabled: () => {},
});

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabled] = useState<boolean>(readStoredPreference);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  }, [enabled]);

  return <SoundContext.Provider value={{ enabled, setEnabled }}>{children}</SoundContext.Provider>;
}

export function useSound() {
  return useContext(SoundContext);
}
