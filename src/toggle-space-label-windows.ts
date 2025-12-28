import { showHUD } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

export default async function Command() {
  try {
    await runAppleScript(`tell application "DesktopRenamer" to toggle labels`);
    await showHUD("Toggled Space Label Windows");
  } catch (error) {
    await showHUD("Failed to toggle labels.");
  }
}
