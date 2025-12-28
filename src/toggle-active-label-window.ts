import { showHUD } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

export default async function Command() {
  try {
    await runAppleScript(`tell application "DesktopRenamer" to toggle active label`);
    await showHUD("Toggled Active Label Window");
  } catch {
    await showHUD("Failed to toggle active label.");
  }
}
