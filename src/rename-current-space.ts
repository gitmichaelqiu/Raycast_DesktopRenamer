import { LaunchProps, showHUD } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

// Define the interface for the arguments
interface RenameArguments {
  newName: string;
}

export default async function Command(props: LaunchProps<{ arguments: RenameArguments }>) {
  const { newName } = props.arguments;

  try {
    // Escape quotes to prevent AppleScript errors if the name contains quotes
    const sanitizedName = newName.replace(/"/g, '\\"');

    // Command syntax: rename current space "Name"
    await runAppleScript(`tell application "DesktopRenamer" to rename current space "${sanitizedName}"`);

    await showHUD(`Renamed space to "${newName}"`);
  } catch (error) {
    console.error(error);
    await showHUD("Failed to rename space. Is DesktopRenamer running?");
  }
}
