import { showToast, Toast, open, environment, LaunchType, getApplications, getPreferenceValues } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const MINIMUM_DESKTOP_RENAMER_API_VERSION = "1.0.0";
const SUPPORTED_DESKTOP_RENAMER_API_MAJOR = 1;

let apiCompatibilityCheck: Promise<void> | null = null;
const execFileAsync = promisify(execFile);
const SPACE_API_COMMAND_NOTIFICATION = "com.michaelqiu.DesktopRenamer.PerformCommand";
const SPACE_API_RESULT_NOTIFICATION = "com.michaelqiu.DesktopRenamer.CommandResult";

type CommunicationMethod = "automatic" | "spaceapi" | "applescript";

function communicationMethod(): CommunicationMethod {
  const value = getPreferenceValues<{ communicationMethod?: CommunicationMethod }>().communicationMethod;
  return value ?? "automatic";
}

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
    const method = communicationMethod();
    const isInstalled = await isDesktopRenamerInstalled();
    if (!isInstalled) {
      throw new Error("NotInstalled");
    }

    if (method === "applescript") {
      const isRunning = await checkDesktopRenamerRunning();
      if (!isRunning) {
        throw new Error("NotRunning");
      }
    }
    if (method !== "applescript") {
      try {
        await ensureCompatibleAPI();
        const apiResult = await runSpaceAPIForScript(scriptContent);
        if (apiResult !== null) return apiResult;
      } catch (error) {
        if (method === "spaceapi") throw error;
      }
    }
    return await runAppleScript(scriptContent);
  } catch (error) {
    await handleDesktopRenamerError(error, errorMessage);
    throw error;
  }
}

async function ensureCompatibleAPI() {
  if (!apiCompatibilityCheck) {
    apiCompatibilityCheck = (async () => {
      const version = String(
        communicationMethod() === "applescript"
          ? await runAppleScript('tell application "DesktopRenamer" to get api version')
          : await runSpaceAPICommand("getAPIVersion", {}),
      ).trim();
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
  const method = communicationMethod();
  if (method !== "applescript") {
    try {
      await ensureCompatibleAPI();
      const apiCommand = parseSpaceAPICommand(command);
      if (apiCommand) return await runSpaceAPICommand(apiCommand.name, apiCommand.arguments);
    } catch (error) {
      if (method === "spaceapi") {
        await handleDesktopRenamerError(error, errorMessage);
        throw error;
      }
    }
  }
  return await runDesktopRenamerScript(`tell application "DesktopRenamer" to ${command}`, errorMessage);
}

function parseSpaceAPICommand(command: string): { name: string; arguments: Record<string, string> } | null {
  const quoted = (value: string) => value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  if (command === "get api version") return { name: "getAPIVersion", arguments: {} };
  if (command === "get current space name") return { name: "getCurrentSpaceName", arguments: {} };
  if (command === "get current space id") return { name: "getCurrentSpaceID", arguments: {} };
  if (command === "get all spaces") return { name: "getAllSpaces", arguments: {} };
  if (command === "move window next") return { name: "moveWindowNext", arguments: {} };
  if (command === "move window previous") return { name: "moveWindowPrevious", arguments: {} };
  if (command === "reload space labels") return { name: "reloadSpaceLabels", arguments: {} };
  if (command === "toggle menubar") return { name: "toggleMenubar", arguments: {} };
  if (command === "toggle launcher") return { name: "toggleLauncher", arguments: {} };
  if (command === "toggle labels") return { name: "toggleLabels", arguments: {} };
  if (command === "toggle active label") return { name: "toggleActiveLabel", arguments: {} };
  if (command === "toggle preview label") return { name: "togglePreviewLabel", arguments: {} };
  if (command === "toggle desktop visibility") return { name: "toggleDesktopVisibility", arguments: {} };

  let match = command.match(/^switch to space "(.*)"$/);
  if (match) return { name: "switchToSpace", arguments: { spaceID: quoted(match[1]) } };
  match = command.match(/^rename current space "(.*)"$/);
  if (match) return { name: "renameCurrentSpace", arguments: { name: quoted(match[1]) } };
  match = command.match(/^rename space "(.*)" to "(.*)"$/);
  if (match) return { name: "renameSpace", arguments: { spaceID: quoted(match[1]), name: quoted(match[2]) } };
  match = command.match(/^move window to space "(.*)"$/);
  if (match) return { name: "moveWindowToSpace", arguments: { spaceID: quoted(match[1]) } };
  match = command.match(/^rearrange space "(.*)" direction "(up|down)"$/);
  if (match) return { name: "rearrangeSpace", arguments: { spaceID: quoted(match[1]), direction: match[2] } };
  match = command.match(/^focus window (\d+) pid (\d+)$/);
  if (match) return { name: "focusWindow", arguments: { windowID: match[1], pid: match[2] } };
  match = command.match(/^execute window action "(\d+)" pid "(\d+)" action "([^"]+)"$/);
  if (match) return { name: "executeWindowAction", arguments: { windowID: match[1], pid: match[2], action: match[3] } };
  match = command.match(/^move specific window "(\d+)"(?: pid "(\d+)")? from space "(.*)" to space "(.*)"$/);
  if (match) {
    const [, windowID, pid, fromSpaceID, targetSpaceID] = match;
    return {
      name: "moveSpecificWindow",
      arguments: {
        windowID,
        ...(pid ? { pid } : {}),
        fromSpaceID: quoted(fromSpaceID),
        targetSpaceID: quoted(targetSpaceID),
      },
    };
  }
  return null;
}

async function runSpaceAPIForScript(scriptContent: string): Promise<string | null> {
  if (scriptContent.includes("get windows")) return await runSpaceAPICommand("getWindows", {});
  if (scriptContent.includes("get all spaces") && scriptContent.includes("get current space name")) {
    const [spaces, name, id] = await Promise.all([
      runSpaceAPICommand("getAllSpaces", {}),
      runSpaceAPICommand("getCurrentSpaceName", {}),
      runSpaceAPICommand("getCurrentSpaceID", {}),
    ]);
    return `${spaces}~~~${name}~~~${id}`;
  }
  return null;
}

async function runSpaceAPICommand(command: string, arguments_: Record<string, string>): Promise<string> {
  const requestID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const script = makeSpaceAPIJXA(requestID, command, arguments_);
  const { stdout, stderr } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return (stdout.trim() ? stdout : stderr).trimEnd();
}

function makeSpaceAPIJXA(requestID: string, command: string, arguments_: Record<string, string>): string {
  const requestObject = { requestID, command, arguments: arguments_ };
  return `
ObjC.import('Foundation');
const requestObject = ${JSON.stringify(requestObject)};
const center = $.NSDistributedNotificationCenter.defaultCenter;
const resultName = '${SPACE_API_RESULT_NOTIFICATION}';
let response = null;
let finished = false;
const observer = center.addObserverForNameObjectQueueUsingBlock(
  resultName,
  undefined,
  undefined,
  function(notification) {
    const info = ObjC.unwrap(notification.userInfo);
    const responseID = info ? ObjC.unwrap(info.requestID) : undefined;
    if (info && String(responseID) === requestObject.requestID) {
      response = info;
      finished = true;
    }
  }
);
const userInfo = $.NSMutableDictionary.dictionary;
userInfo.setObjectForKey(requestObject.requestID, 'requestID');
userInfo.setObjectForKey(requestObject.command, 'command');
userInfo.setObjectForKey(JSON.stringify(requestObject.arguments), 'argumentsJSON');
center.postNotificationNameObjectUserInfoDeliverImmediately('${SPACE_API_COMMAND_NOTIFICATION}', undefined, userInfo, true);
const deadline = Date.now() + 10000;
while (!finished && Date.now() < deadline) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
}
center.removeObserver(observer);
if (!response) throw new Error('SpaceAPI request timed out.');
const success = ObjC.unwrap(response.success);
if (!(success === true || String(success) === 'true' || String(success) === '1')) {
  const error = ObjC.unwrap(response.error);
  throw new Error(String(error || 'SpaceAPI command failed.'));
}
const result = ObjC.unwrap(response.result);
console.log(String(result || ''));
`;
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
