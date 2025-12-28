import { showHUD } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

export default async function Command() {
  try {
    await runAppleScript(`tell application "DesktopRenamer" to toggle desktop visibility`);
    await showHUD("Toggled Active Label Visibility");
  } catch {
    await showHUD("Failed to toggle desktop visibility.");
  }
}
