import { showToast, Toast, open, environment, LaunchType, getApplications } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";

export const MINIMUM_DESKTOP_RENAMER_API_VERSION = "1.0.0";
const SUPPORTED_DESKTOP_RENAMER_API_MAJOR = 1;

let apiCompatibilityCheck: Promise<void> | null = null;

export function escapeAppleScriptString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function isDesktopRenamerInstalled(): Promise<boolean> {
  const applications = await getApplications();
  return applications.some((app) => app.bundleId === "com.michaelqiu.DesktopRenamer");
}

export async function checkDesktopRenamerRunning(): Promise<boolean> {
  try {
    const isRunning = await runAppleScript(
      'tell application "System Events" to return (name of processes) contains "DesktopRenamer"',
    );
    return isRunning === "true";
  } catch {
    return false;
  }
}

export async function handleDesktopRenamerError(error: unknown, errorMessage = "Is DesktopRenamer running?") {
  if (environment.launchType === LaunchType.UserInitiated) {
    if (error instanceof Error && error.message === "NotInstalled") {
      await showToast({
        style: Toast.Style.Failure,
        title: "DesktopRenamer Not Installed",
        message: "Please install DesktopRenamer to use this command.",
        primaryAction: {
          title: "Download App",
          onAction: () => open("https://github.com/gitmichaelqiu/DesktopRenamer"),
        },
      });
    } else if (error instanceof Error && error.message === "NotRunning") {
      await showToast({
        style: Toast.Style.Failure,
        title: "DesktopRenamer Not Running",
        message: "Open DesktopRenamer to use this command.",
        primaryAction: {
          title: "Open DesktopRenamer",
          onAction: async () => {
            try {
              await open("/Applications/DesktopRenamer.app");
            } catch {
              await showToast({ style: Toast.Style.Failure, title: "Failed to launch app" });
            }
          },
        },
      });
    } else if (error instanceof Error && error.message.includes("API Disabled")) {
      await showToast({
        style: Toast.Style.Failure,
        title: "SpaceAPI Disabled",
        message: "Enable SpaceAPI in DesktopRenamer settings.",
        primaryAction: {
          title: "Open DesktopRenamer",
          onAction: async () => {
            try {
              await open("/Applications/DesktopRenamer.app");
            } catch {
              await showToast({ style: Toast.Style.Failure, title: "Failed to launch app" });
            }
          },
        },
      });
    } else {
      const message = error instanceof Error ? error.message : errorMessage;
      await showToast({
        style: Toast.Style.Failure,
        title: "Command Failed",
        message: message || errorMessage,
        primaryAction: {
          title: "Open DesktopRenamer",
          onAction: async () => {
            try {
              await open("/Applications/DesktopRenamer.app");
            } catch {
              await showToast({ style: Toast.Style.Failure, title: "Failed to launch app" });
            }
          },
        },
      });
    }
  }
}

export async function runDesktopRenamerScript(scriptContent: string, errorMessage = "Is DesktopRenamer running?") {
  try {
    const isInstalled = await isDesktopRenamerInstalled();
    if (!isInstalled) {
      throw new Error("NotInstalled");
    }

    const isRunning = await checkDesktopRenamerRunning();
    if (!isRunning) {
      throw new Error("NotRunning");
    }
    await ensureCompatibleAPI();
    return await runAppleScript(scriptContent);
  } catch (error) {
    await handleDesktopRenamerError(error, errorMessage);
    throw error;
  }
}

async function ensureCompatibleAPI() {
  if (!apiCompatibilityCheck) {
    apiCompatibilityCheck = (async () => {
      const version = String(await runAppleScript('tell application "DesktopRenamer" to get api version')).trim();
      const apiMajor = Number.parseInt(version.split(".")[0] ?? "", 10);
      if (
        compareVersions(version, MINIMUM_DESKTOP_RENAMER_API_VERSION) < 0 ||
        apiMajor !== SUPPORTED_DESKTOP_RENAMER_API_MAJOR
      ) {
        throw new Error(
          `DesktopRenamer API major version ${SUPPORTED_DESKTOP_RENAMER_API_MAJOR} is required (found ${version || "unknown"})`,
        );
      }
    })().catch((error) => {
      apiCompatibilityCheck = null;
      throw error;
    });
  }
  return apiCompatibilityCheck;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export async function runDesktopRenamerCommand(command: string, errorMessage = "Is DesktopRenamer running?") {
  return await runDesktopRenamerScript(`tell application "DesktopRenamer" to ${command}`, errorMessage);
}

export async function moveSpecificWindowToSpace(args: {
  windowID: number;
  pid: number;
  fromSpaceID: string;
  targetSpaceID: string;
}) {
  const windowID = escapeAppleScriptString(String(args.windowID));
  const pid = escapeAppleScriptString(String(args.pid));
  const fromSpaceID = escapeAppleScriptString(args.fromSpaceID);
  const targetSpaceID = escapeAppleScriptString(args.targetSpaceID);

  await runDesktopRenamerCommand(
    `move specific window "${windowID}" pid "${pid}" from space "${fromSpaceID}" to space "${targetSpaceID}"`,
  );
}
