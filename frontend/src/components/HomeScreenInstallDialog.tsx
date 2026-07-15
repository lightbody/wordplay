import { Dialog } from "./Dialog";

/** Walks an iOS Safari user through installing to the Home Screen, the only way Safari allows Web Push. */
export function HomeScreenInstallDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      onClose={onClose}
      title="Turn on notifications"
      actions={
        <button type="button" className="btn btn-primary" onClick={onClose}>
          Got it
        </button>
      }
    >
      <p className="account-menu-hint install-steps-intro">
        Safari only allows notifications for apps added to your Home Screen.
      </p>
      <ol className="install-steps">
        <li>
          Tap <strong>&bull;&bull;&bull;</strong> in Safari&rsquo;s toolbar
        </li>
        <li>
          Tap <strong>Share</strong>
        </li>
        <li>
          Scroll down and tap <strong>Add to Home Screen</strong>
        </li>
        <li>Open Wordplay from your Home Screen, then turn notifications on there</li>
      </ol>
    </Dialog>
  );
}
