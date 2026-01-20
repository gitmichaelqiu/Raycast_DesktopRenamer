import { updateCommandMetadata } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

export default async function Command() {
  try {
    // According to DesktopRenamer.sdef, the command is "get current space name"
    // It returns a text string.
    const script = `
      try
        tell application "DesktopRenamer" to get current space name
      on error e
        return "ERROR: " & e
      end try
    `;

    const result = await runAppleScript(script);

    if (result.startsWith("ERROR") || !result) {
      console.error("AppleScript Error:", result);
      await updateCommandMetadata({
        subtitle: `Connection Failed`,
      });
      return;
    }

    const name = result.trim();
    
    // Calculate time ago (approximate since we just ran it)
    const timeString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Update metadata. 
    // Since we only get the name from the SDEF command, we display just the name.
    await updateCommandMetadata({
      subtitle: `${name}`,
    });
  } catch (error) {
    console.error(error);
    await updateCommandMetadata({
      subtitle: "Error",
    });
  }
}
