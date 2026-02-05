import { List, ActionPanel, Action, Icon, Color, showToast, Toast, Form, useNavigation } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { runDesktopRenamerCommand } from "./utils";

interface Space {
  id: string;
  name: string;
  displayID: string;
  num: number;
}

export default function Command() {
  const { data, isLoading, error } = usePromise(async () => {
    // 1. Get all spaces (ID|Name|DisplayID|Num format per line)
    // 2. Get current space name
    const script = `get all spaces) & "|||||" & (get current space name`;
    // We use runDesktopRenamerCommand to reuse the connection check logic, 
    // but we need to pass the raw AppleScript command content slightly differently or stick to runAppleScript with custom check.
    // runDesktopRenamerCommand wraps "tell application..."
    // So we can pass: `get all spaces) & "|||||" & (get current space name` 
    // wait, the previous script was `return allSpaces...`. runDesktopRenamerCommand returns the result string.

    // Let's rewrite the script to be a simple one-liner compatible with "tell app ... to [command]"
    // Or just use runDesktopRenamerCommand with a compound command.
    // "tell app ... to set x to ... " is hard to pipe via `runDesktopRenamerCommand` which does `tell app ... to [command]`.

    // So we stick to runDesktopRenamerCommand strictly for simple commands OR we make utils expose a robust "runScript" that handles the tell block.
    // CURRENT utils: `tell application "DesktopRenamer" to ${command}`
    // We can't easily do complex blocks unless we change utils.

    // Strategy: Use runDesktopRenamerCommand with a computed string that works in one line or change utils?
    // Changing utils to support full blocks is better but risky for other callers.

    // Let's stick to using `runDesktopRenamerCommand` for the individual actions.
    // For the data loading, we'll manually wrap `runAppleScript` with the "Open App" toast logic if it fails.

    return await runDesktopRenamerCommand(`return (get all spaces) & "|||||" & (get current space name)`);
  });

  // Parse data
  let spaces: Space[] = [];
  let currentName = "";

  if (data) {
    const [spacesStr, curName] = data.split("|||||");
    currentName = curName ? curName.trim() : "";
    spaces = spacesStr
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const parts = line.split("|");
        return {
          id: parts[0],
          name: parts[1] || "Unknown",
          displayID: parts[2] || "Main",
          num: parseInt(parts[3] || "0", 10)
        };
      });
  }

  async function switchSpace(space: Space) {
    try {
      await runDesktopRenamerCommand(`switch to space "${space.id}"`);
    } catch {
      // Handled by utils
    }
  }

  // ... Grouping logic ...
  const groupedSpaces = spaces.reduce((acc, space) => {
    const group = acc[space.displayID] || [];
    group.push(space);
    acc[space.displayID] = group;
    return acc;
  }, {} as Record<string, Space[]>) || {};

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search desktops...">
      {/* ... List Logic ... */}
      {Object.entries(groupedSpaces).map(([displayID, spaces]) => (
        <List.Section key={displayID} title={displayID}>
          {spaces.map((space) => {
            const isCurrent = space.name === currentName;
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
                  isCurrent ? [{ tag: { value: "Current", color: Color.Blue } }] : []
                }
                actions={
                  <ActionPanel>
                    <Action
                      title="Switch to Desktop"
                      icon={Icon.Desktop}
                      onAction={() => switchSpace(space)}
                    />
                    <Action.Push
                      title="Rename Space"
                      shortcut={{ modifiers: ["cmd"], key: "r" }}
                      icon={Icon.Pencil}
                      target={<RenameSpaceForm space={space} onRename={() => {
                        // trigger revalidation?
                      }} />}
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

function RenameSpaceForm({ space, onRename }: { space: Space; onRename: () => void }) {
  const { pop } = useNavigation();

  async function handleRename(values: { name: string }) {
    try {
      await runDesktopRenamerCommand(`rename space "${space.id}" to "${values.name}"`);
      await showToast({ style: Toast.Style.Success, title: "Renamed space" });
      onRename();
      pop();
    } catch {
      // Handled
    }
  }
  // ...

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Rename" onSubmit={handleRename} />
        </ActionPanel>
      }
    >
      <Form.TextField id="name" title="New Name" defaultValue={space.name} placeholder="Enter new name" />
    </Form>
  );
}