import { showHUD } from "@raycast/api";
import { runDesktopRenamerScript } from "./utils";

export default async function Command() {
  try {
    // Use full tell block — single-line "tell...to reload space labels"
    // hits AppleScript parser ambiguity on "space" as an identifier.
    await runDesktopRenamerScript(`
      tell application "DesktopRenamer"
        reload space labels
      end tell
    `);
    await showHUD("Labels reloaded");
  } catch {
    // Error handled by utils
  }
}
