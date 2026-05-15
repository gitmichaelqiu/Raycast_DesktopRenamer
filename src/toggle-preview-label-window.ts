import { showHUD, updateCommandMetadata, environment, LaunchType } from "@raycast/api";
import { runDesktopRenamerCommand } from "./utils";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export default async function Command() {
  if (environment.launchType === LaunchType.Background) {
    try {
      const { stdout } = await execAsync("defaults read com.michaelqiu.DesktopRenamer kShowPreviewLabels");
      const isOn = stdout.trim() === "1";
      await updateCommandMetadata({ subtitle: isOn ? "On" : "Off" });
    } catch {
      await updateCommandMetadata({ subtitle: "On" }); // Default is true
    }
    return;
  }

  try {
    const result = await runDesktopRenamerCommand("toggle preview label", "Failed to toggle preview label");
    const isOn = result === "true";
    await updateCommandMetadata({ subtitle: isOn ? "On" : "Off" });
    await showHUD(`Preview Label: ${isOn ? "On" : "Off"}`);
  } catch {
    // Error handled by utils
  }
}

