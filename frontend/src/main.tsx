import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthKitProvider } from "@workos-inc/authkit-react";
import App from "./App";
import { getDictionary } from "./dictionary";
import { registerServiceWorker } from "./push";
import { ThemeProvider } from "./theme";
import { SoundProvider } from "./sound";
import "./App.css";

const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID;
if (!clientId) {
  throw new Error("VITE_WORKOS_CLIENT_ID is not set");
}

// Warm the dictionary cache as early as possible so it's ready before any
// game screen mounts, without blocking initial render on it.
void getDictionary();

// Registering (unlike subscribing) doesn't prompt for permission, so it's
// safe to do unconditionally on boot -- the service worker is then ready by
// the time the user taps "Enable notifications".
void registerServiceWorker();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <SoundProvider>
        {/* Preserve the current path (not just the origin) so signing in from
            a deep link like /friend/:token or /invite/:token returns the user
            to that same page to complete the accept, instead of dropping them
            on "/" and losing the pending token. */}
        <AuthKitProvider
          clientId={clientId}
          redirectUri={window.location.origin + window.location.pathname}
          devMode={true}
        >
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthKitProvider>
      </SoundProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
