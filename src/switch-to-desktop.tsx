import { List, ActionPanel, Action, Icon, Color, showToast, Toast } from "@raycast/api";
import { usePromise, runAppleScript } from "@raycast/utils";

interface Space {
  id: string;
  name: string;
}

export default function Command() {
  const { data, isLoading } = usePromise(async () => {
    // 1. Get all spaces (ID|Name format per line)
    // 2. Get current space name (since we can't easily get current ID to match, we match by name)
    const script = `
      try
        tell application "DesktopRenamer"
          set allSpaces to get all spaces
          set currentName to get current space name
          return allSpaces & "|||||" & currentName
        end tell
      on error e
        return "ERROR: " & e
      end try
    `;

    const result = await runAppleScript(script);

    if (result.startsWith("ERROR")) {
      throw new Error(result.replace("ERROR: ", ""));
    }

    const [spacesStr, currentName] = result.split("|||||");
    
    const spaces: Space[] = spacesStr
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        // Find the first pipe to separate ID from Name
        const idx = line.indexOf("|");
        if (idx === -1) return { id: line, name: "Unknown" };
        
        const id = line.substring(0, idx);
        const name = line.substring(idx + 1);
        return { id, name };
      });

    return { 
      spaces, 
      currentName: currentName.trim() 
    };
  });

  async function switchSpace(space: Space) {
    try {
      await runAppleScript(`tell application "DesktopRenamer" to switch to space "${space.id}"`);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to switch space",
        message: String(error),
      });
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search desktops...">
      {data?.spaces.map((space) => {
        const isCurrent = space.name === data.currentName;
        
        return (
          <List.Item
            key={space.id}
            title={space.name}
            // Highlight the icon and add a tag if it's the current desktop
            icon={{ 
              source: Icon.Desktop, 
              tintColor: isCurrent ? Color.Blue : undefined 
            }}
            accessories={
              isCurrent
                ? [{ tag: { value: "Current", color: Color.Blue } }]
                : []
            }
            actions={
              <ActionPanel>
                <Action 
                  title="Switch to Desktop" 
                  icon={Icon.Desktop}
                  onAction={() => switchSpace(space)} 
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}