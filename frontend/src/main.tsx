import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthKitProvider } from "@workos-inc/authkit-react";
import App from "./App";
import { getDictionary } from "./dictionary";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <SoundProvider>
        <AuthKitProvider clientId={clientId} redirectUri={window.location.origin} devMode={true}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthKitProvider>
      </SoundProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
