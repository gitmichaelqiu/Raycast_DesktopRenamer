import { Form, ActionPanel, Action, showToast, Toast, popToRoot, Icon } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { useState } from "react";
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
          title: parts.slice(4).join("|"),
          space: { ...currentSpace },
        });
      }
    }
  }
  return { spaces, windows };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function Command() {
  const [isExecuting, setIsExecuting] = useState(false);

  const { data, isLoading } = usePromise(async () => {
    const result = await runDesktopRenamerScript(`
      tell application "DesktopRenamer"
        get windows
      end tell
    `);
    return parseWindowData(result);
  });

  const spaces = data?.spaces ?? [];
  const windows = data?.windows ?? [];

  // Group windows by space
  const windowsBySpace = new Map<string, WindowEntry[]>();
  for (const w of windows) {
    const list = windowsBySpace.get(w.space.id) ?? [];
    list.push(w);
    windowsBySpace.set(w.space.id, list);
  }

  async function handleSubmit(values: Record<string, string>) {
    // Collect all moves that are NOT "keep"
    const moves: { window: WindowEntry; targetSpaceId: string }[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (value !== "keep") {
        const windowID = parseInt(key.replace("win_", ""), 10);
        const win = windows.find((w) => w.windowID === windowID);
        if (win && win.space.id !== value) {
          moves.push({ window: win, targetSpaceId: value });
        }
      }
    }

    if (moves.length === 0) {
      await showToast({ style: Toast.Style.Success, title: "No moves required" });
      await popToRoot();
      return;
    }

    setIsExecuting(true);
    const toast = await showToast({ style: Toast.Style.Animated, title: "Executing batch move..." });

    try {
      // Remember where we started to return later
      const currentIdsRaw = await runDesktopRenamerCommand("get current space id");
      const currentIds = currentIdsRaw.split(",").map((s: string) => s.trim());
      const originalSpaceId = currentIds.length > 0 ? currentIds[0] : null;

      // Group moves by the window's SOURCE space to minimize space switching.
      // E.g., we go to Space A, move all targeted windows out, then go to Space B, etc.
      const movesBySource = new Map<string, typeof moves>();
      for (const move of moves) {
        const list = movesBySource.get(move.window.space.id) ?? [];
        list.push(move);
        movesBySource.set(move.window.space.id, list);
      }

      let totalMoved = 0;
      for (const [sourceId, sourceMoves] of movesBySource.entries()) {
        toast.message = `Processing ${sourceMoves[0].window.space.name}...`;
        
        // Switch to the source space once for all its windows
        await runDesktopRenamerCommand(`switch to space "${escapeAppleScriptString(sourceId)}"`);
        await delay(600); // Give Mission Control time to settle

        for (const move of sourceMoves) {
          toast.message = `Moving ${move.window.title}...`;
          
          // Focus the specific window (making it the active window in this space)
          await runDesktopRenamerCommand(`focus window ${move.window.windowID} pid ${move.window.pid}`);
          await delay(250); 
          
          // Execute the backend move operation on the active window
          await runDesktopRenamerCommand(`move window to space "${escapeAppleScriptString(move.targetSpaceId)}"`);
          await delay(500); // Wait for the backend drag action
          totalMoved++;

          // Since move window to space switches the system to the target space,
          // we must switch BACK to our current source space to process the next window in this group.
          if (sourceMoves.indexOf(move) < sourceMoves.length - 1) {
            await runDesktopRenamerCommand(`switch to space "${escapeAppleScriptString(sourceId)}"`);
            await delay(600);
          }
        }
      }

      // Finally, return to the desktop where the user started the command
      if (originalSpaceId) {
        toast.message = "Returning to original desktop...";
        await runDesktopRenamerCommand(`switch to space "${escapeAppleScriptString(originalSpaceId)}"`);
        await delay(400);
      }

      toast.style = Toast.Style.Success;
      toast.title = `Successfully moved ${totalMoved} window${totalMoved === 1 ? "" : "s"}`;
      await popToRoot();
    } catch (e) {
      toast.style = Toast.Style.Failure;
      toast.title = "Batch move failed";
      toast.message = String(e);
      setIsExecuting(false);
    }
  }

  return (
    <Form
      isLoading={isLoading || isExecuting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Execute Batch Move" icon={Icon.Checkmark} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      {spaces.map((space) => {
        const spaceWindows = windowsBySpace.get(space.id) ?? [];
        if (spaceWindows.length === 0) return null;

        return (
          <Form.Description 
            key={`header_${space.id}`} 
            title={space.name} 
            text={`${spaceWindows.length} window${spaceWindows.length === 1 ? "" : "s"}`} 
          />
        );
      })}
      
      <Form.Separator />

      {spaces.map((space) => {
        const spaceWindows = windowsBySpace.get(space.id) ?? [];
        return spaceWindows.map((win) => (
          <Form.Dropdown
            key={`win_${win.windowID}`}
            id={`win_${win.windowID}`}
            title={win.ownerName}
            info={win.title}
            defaultValue="keep"
          >
            <Form.Dropdown.Item title="Keep on current desktop" value="keep" icon={Icon.Minus} />
            <Form.Dropdown.Section title="Move to">
              {spaces
                .filter((s) => s.id !== space.id)
                .map((targetSpace) => (
                  <Form.Dropdown.Item
                    key={targetSpace.id}
                    title={targetSpace.name}
                    value={targetSpace.id}
                    icon={Icon.Desktop}
                  />
                ))}
            </Form.Dropdown.Section>
          </Form.Dropdown>
        ));
      })}
    </Form>
  );
}
