import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthKitProvider } from "@workos-inc/authkit-react";
import App from "./App";
import "./App.css";
import { loadEngine } from "./wasmEngine";

const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID;
if (!clientId) {
  throw new Error("VITE_WORKOS_CLIENT_ID is not set");
}

// Warm the word-validation engine as early as possible, well before a user
// reaches GameScreen -- not gated behind auth/routing, never awaited.
loadEngine();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthKitProvider clientId={clientId} redirectUri={window.location.origin} devMode={true}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthKitProvider>
  </React.StrictMode>,
);
