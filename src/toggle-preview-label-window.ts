import { showHUD } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

export default async function Command() {
  try {
    await runAppleScript(`tell application "DesktopRenamer" to toggle preview label`);
    await showHUD("Toggled Preview Label Window");
  } catch {
    await showHUD("Failed to toggle preview label.");
  }
}
