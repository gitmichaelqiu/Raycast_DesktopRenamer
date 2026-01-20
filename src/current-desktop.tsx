import { updateCommandMetadata } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

export default async function Command() {
  try {
    // 1. Fetch current space name via AppleScript
    // mimicking music.currentTrack.getCurrentTrack()
    const currentSpaceName = await runAppleScript(`tell application "DesktopRenamer" to get current space name`);
    
    // 2. On Success: Update subtitle
    // mimicking TE.map((track) => updateCommandMetadata...)
    await updateCommandMetadata({ subtitle: currentSpaceName });
    
  } catch (error) {
    // 3. On Error: Update subtitle with error message
    // mimicking TE.mapLeft(() => updateCommandMetadata...)
    await updateCommandMetadata({ subtitle: "Error: App not running" });
    console.error("Failed to fetch space name:", error);
  }
  
  // Implicit return; command finishes.
  // Because mode is "no-view", Raycast handles this as a background run or 'toast-less' execution if nothing is returned.
}