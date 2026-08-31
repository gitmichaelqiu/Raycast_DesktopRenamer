import { Form, ActionPanel, Action, useNavigation, showToast, Toast } from "@raycast/api";
import { usePromise } from "@raycast/utils";
import { getSpaceSnapshot, renameSpace, SpaceAPISnapshot } from "./utils";

export interface Space {
  id: string;
  name: string;
  displayID: string;
  displayName: string;
  num: number;
  isFullscreen: boolean | undefined;
  appPath?: string;
}

export function isMoveTarget(space: Pick<Space, "isFullscreen">) {
  return space.isFullscreen === false;
}

export function useSpaces() {
  const { data, isLoading, revalidate } = usePromise<() => Promise<SpaceAPISnapshot | null>>(async () => {
    try {
      return await getSpaceSnapshot();
    } catch {
      return null;
    }
  });

  let spaces: Space[] = [];
  let currentName = "";
  let currentId = "";

  if (data) {
    const snapshot: SpaceAPISnapshot = data;
    currentName = snapshot.currentSpaceName;
    currentId = snapshot.currentSpaceIDs.join(",");
    spaces = snapshot.spaces.map((space) => ({
      id: space.id,
      name: space.name || "Unknown",
      displayID: space.displayID || "Main",
      displayName: space.displayName || space.displayID || "Main",
      num: space.number,
      isFullscreen: space.isFullscreen,
      appPath: space.appPath ?? undefined,
    }));
  }

  const groupedSpaces =
    spaces.reduce(
      (acc, space) => {
        const group = acc[space.displayName] || [];
        group.push(space);
        acc[space.displayName] = group;
        return acc;
      },
      {} as Record<string, Space[]>,
    ) || {};

  return {
    spaces,
    currentName,
    currentId,
    groupedSpaces,
    isLoading,
    revalidate,
  };
}

export function RenameSpaceForm({ space, onRename }: { space: Space; onRename: () => void }) {
  const { pop } = useNavigation();

  async function handleRename(values: { name: string }) {
    try {
      await renameSpace(space.id, values.name, "Failed to rename space");
      await showToast({ style: Toast.Style.Success, title: "Renamed space" });
      onRename();
      pop();
    } catch {
      // Handled
    }
  }

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
