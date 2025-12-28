import { showHUD } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

export default async function Command() {
  try {
    await runAppleScript(`tell application "DesktopRenamer" to toggle menubar`);
    await showHUD("Toggled Menubar Item");
  } catch (error) {
    await showHUD("Failed to toggle menubar item. Is DesktopRenamer running?");
  }
}