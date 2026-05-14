import { List, ActionPanel, Action, Icon, showToast, Toast, popToRoot } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { runDesktopRenamerCommand, runDesktopRenamerScript, escapeAppleScriptString } from "./utils";

interface SpaceGroup {
  id: string;
  name: string;
  displayID: string;
  num: number;
}

interface WindowEntry {
  windowID: number;
  pid: number;
  ownerName: string;
  appPath: string;
  title: string;
  space: SpaceGroup;
}

function parseWindowData(raw: string): { spaces: SpaceGroup[]; windows: WindowEntry[] } {
  const spaces: SpaceGroup[] = [];
  const windows: WindowEntry[] = [];
  let currentSpace: SpaceGroup | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith(">")) {
      const parts = line.slice(1).split("~");
      currentSpace = {
        id: parts[0],
        name: parts[1] || "Unknown",
        displayID: parts[2] || "Display",
        num: parseInt(parts[3] || "0", 10),
      };
      spaces.push(currentSpace);
    } else if (line.startsWith("  ") && currentSpace) {
      const parts = line.trim().split("|");
      if (parts.length >= 5) {
        windows.push({
          windowID: parseInt(parts[0], 10),
          pid: parseInt(parts[1], 10),
          ownerName: parts[2],
          appPath: parts[3],
          title: parts.slice(4).join("|"), // title may contain pipes
          space: { ...currentSpace },
        });
      }
    }
  }
  return { spaces, windows };
}

export default function Command() {
  const { data, isLoading } = usePromise(async () => {
    const result = await runDesktopRenamerScript(`
      tell application "DesktopRenamer"
        get windows
      end tell
    `);
    return parseWindowData(result);
  });

  async function switchToWindow(entry: WindowEntry) {
    try {
      const sanitizedId = escapeAppleScriptString(entry.space.id);
      // Switch to the space first, then focus the specific window.
      await runDesktopRenamerCommand(`switch to space "${sanitizedId}"`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      await runDesktopRenamerCommand(`focus window ${entry.windowID} pid ${entry.pid}`);
      await showToast({ style: Toast.Style.Success, title: `Switched to ${entry.title}` });
      await popToRoot();
    } catch {
      // Error handled by utils
    }
  }

  // Group windows by space ID, preserving space order from the data.
  const spaceOrder = data?.spaces ?? [];
  const windowsBySpace = new Map<string, WindowEntry[]>();
  for (const w of data?.windows ?? []) {
    const list = windowsBySpace.get(w.space.id) ?? [];
    list.push(w);
    windowsBySpace.set(w.space.id, list);
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search windows...">
      {spaceOrder.map((space) => {
        const windows = windowsBySpace.get(space.id) ?? [];
        return (
          <List.Section
            key={space.id}
            title={space.name}
            subtitle={`${space.displayID} · Space ${space.num}`}
          >
            {windows.length === 0 ? (
              <List.Item key={`empty-${space.id}`} title="No windows" icon={Icon.Minus} />
            ) : (
              windows.map((entry) => (
                <List.Item
                  key={`${entry.windowID}`}
                  title={entry.title}
                  subtitle={entry.ownerName}
                  icon={entry.appPath ? { fileIcon: entry.appPath } : Icon.Window}
                  actions={
                    <ActionPanel>
                      <Action
                        title="Switch to Window"
                        icon={Icon.Window}
                        onAction={() => switchToWindow(entry)}
                      />
                    </ActionPanel>
                  }
                />
              ))
            )}
          </List.Section>
        );
      })}
    </List>
  );
}
