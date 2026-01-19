import { ActionPanel, Action, List, showToast, Toast, closeMainWindow, Icon } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { useEffect, useState } from "react";

interface Space {
  id: string;
  name: string;
}

export default function Command() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchSpaces() {
      try {
        // Returns "ID|Name\nID|Name"
        const result = await runAppleScript(`tell application "DesktopRenamer" to get all spaces`);
        
        if (!result) {
            setSpaces([]);
            setIsLoading(false);
            return;
        }

        const parsedSpaces = result.split("\n").map((line) => {
          const [id, ...nameParts] = line.split("|");
          return { id, name: nameParts.join("|") };
        });

        setSpaces(parsedSpaces);
        setIsLoading(false);
      } catch (error) {
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to fetch spaces",
          message: "Is DesktopRenamer running?",
        });
        setIsLoading(false);
      }
    }

    fetchSpaces();
  }, []);

  const switchSpace = async (spaceId: string) => {
    try {
      await runAppleScript(`tell application "DesktopRenamer" to switch to space "${spaceId}"`);
      await closeMainWindow(); 
    } catch (error) {
      showToast({
        style: Toast.Style.Failure,
        title: "Failed to switch space",
        message: String(error),
      });
    }
  };

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search desktops...">
      {spaces.map((space) => (
        <List.Item
          key={space.id}
          title={space.name}
          icon={Icon.Desktop}
          actions={
            <ActionPanel>
              <Action title="Switch to Desktop" onAction={() => switchSpace(space.id)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}