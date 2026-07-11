// Persistent harness for the AccountMenu avatar dropdown on the landing
// page's topbar (username, theme picker, sign out). GameList itself needs
// WorkOS auth + a live backend + ElectricSQL, none of which are available in
// a Claude Code remote session, so this mounts the real component with
// hand-built mock data instead. Not part of the app: not imported from
// main.tsx, not linked from any route. `npm run dev` and navigate to
// /account-menu-harness.html. See CLAUDE.md.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./theme";
import { AccountMenu } from "./components/AccountMenu";
import "./App.css";

function Harness() {
  const [avatarEmoji, setAvatarEmoji] = useState("🦊");
  const [avatarColor, setAvatarColor] = useState("coral-vivid");
  return (
    <ThemeProvider>
      <div className="app-page">
        <header className="topbar">
          <span className="wordmark wordmark-sm">Wordplay</span>
          <AccountMenu
            username="PSquad32"
            email="patrick@lightbody.net"
            avatarEmoji={avatarEmoji}
            avatarColor={avatarColor}
            onAvatarSave={async (emoji, color) => {
              setAvatarEmoji(emoji);
              setAvatarColor(color);
            }}
            onSignOut={() => alert("sign out")}
          />
        </header>
        <div className="content">
          <button className="btn btn-primary btn-lg btn-block">+ New game</button>
        </div>
      </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
