import { showHUD } from "@raycast/api";
import { runDesktopRenamerCommand } from "./utils";

export default async function Command() {
  try {
    await runDesktopRenamerCommand("reload labels", "Failed to reload labels");
    await showHUD("Labels reloaded");
  } catch {
    // Error handled by utils
  }
}
