import { List, ActionPanel, Action, Icon, Color, showToast, Toast } from "@raycast/api";
import { usePromise, runAppleScript } from "@raycast/utils";

interface Space {
  id: string;
  name: string;
  displayID: string;
  num: number;
}

export default function Command() {
  const { data, isLoading } = usePromise(async () => {
    // 1. Get all spaces (ID|Name|DisplayID|Num format per line)
    // 2. Get current space name
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
        // Format: ID|Name|DisplayID|Num
        // Backward compatibility: If only ID|Name, handle gracefully
        const parts = line.split("|");
        const id = parts[0];
        const name = parts[1] || "Unknown";
        const displayID = parts[2] || "Main";
        const num = parseInt(parts[3] || "0", 10);
        
        return { id, name, displayID, num };
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

  // Group spaces by Display ID
  const groupedSpaces = data?.spaces.reduce((acc, space) => {
    const group = acc[space.displayID] || [];
    group.push(space);
    acc[space.displayID] = group;
    return acc;
  }, {} as Record<string, Space[]>) || {};

  // Sort groups: Main first (usually has ID "Main" or similar, or based on content)
  // We can try to sort visually or just iterate keys.
  // Since the AppleScript returns sorted list from SpaceManager (Main first), 
  // relying on array order is safer if we preserve it.
  
  // Alternative: Just simple List with sections based on iteration
  // We need to know when display changes.
  
  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search desktops...">
      {Object.entries(groupedSpaces).map(([displayID, spaces]) => (
        <List.Section key={displayID} title={displayID}>
          {spaces.map((space) => {
             const isCurrent = space.name === data?.currentName;
             return (
               <List.Item
                 key={space.id}
                 title={space.name}
                 subtitle={`Space ${space.num}`}
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
        </List.Section>
      ))}
    </List>
  );
}