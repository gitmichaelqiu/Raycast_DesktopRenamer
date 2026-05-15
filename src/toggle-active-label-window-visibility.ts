import { showHUD, updateCommandMetadata, environment, LaunchType } from "@raycast/api";
import { runDesktopRenamerCommand } from "./utils";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export default async function Command() {
  if (environment.launchType === LaunchType.Background) {
    try {
      const { stdout } = await execAsync("defaults read com.michaelqiu.DesktopRenamer kShowOnDesktop");
      const isOn = stdout.trim() === "1";
      await updateCommandMetadata({ subtitle: isOn ? "On" : "Off" });
    } catch {
      await updateCommandMetadata({ subtitle: "Off" }); // Default is false for desktop visibility
    }
    return;
  }

  try {
    const result = await runDesktopRenamerCommand("toggle desktop visibility", "Failed to toggle desktop visibility");
    const isOn = result === "true";
    await updateCommandMetadata({ subtitle: isOn ? "On" : "Off" });
    await showHUD(`Desktop Label: ${isOn ? "On" : "Off"}`);
  } catch {
    // Error handled by utils
  }
}

