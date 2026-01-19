import { updateCommandMetadata, showToast, Toast } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

export default async function Command() {
  try {
    const currentSpaceName = await runAppleScript(`tell application "DesktopRenamer" to get current space name`);
    
    // Update the subtitle of the command in the Raycast root search
    await updateCommandMetadata({ subtitle: currentSpaceName });
    
    // Optional: Show a quiet toast to confirm it updated, or do nothing.
    // Given "Running the command will not do anything", we just update metadata and exit.
    
  } catch (error) {
    // If it fails, likely app isn't running. We can clear the subtitle or show error.
    await updateCommandMetadata({ subtitle: "Error: App not running" });
    
    await showToast({
      style: Toast.Style.Failure,
      title: "Failed to fetch space name",
      message: "Is DesktopRenamer running?",
    });
  }
}