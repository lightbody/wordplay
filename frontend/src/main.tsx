import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthKitProvider } from "@workos-inc/authkit-react";
import App from "./App";
import "./App.css";

const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID;
if (!clientId) {
  throw new Error("VITE_WORKOS_CLIENT_ID is not set");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthKitProvider clientId={clientId} redirectUri={window.location.origin} devMode={true}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthKitProvider>
  </React.StrictMode>,
);
