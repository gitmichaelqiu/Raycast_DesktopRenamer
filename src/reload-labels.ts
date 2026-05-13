import { showHUD } from "@raycast/api";
import { runDesktopRenamerScript } from "./utils";

export default async function Command() {
  try {
    // Toggle each label off and back on to force window refresh.
    // The native app's reloadAllWindows() is not exposed as an AppleScript command,
    // so we trigger updateWindows() via the label toggle didSet as a workaround.
    await runDesktopRenamerScript(`
      tell application "DesktopRenamer"
        toggle active label
        toggle active label

        toggle preview label
        toggle preview label
      end tell
    `);
    await showHUD("Labels reloaded");
  } catch {
    // Error handled by utils
  }
}
