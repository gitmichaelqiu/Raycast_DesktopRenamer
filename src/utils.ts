import { showToast, Toast, open, environment, LaunchType, getApplications, getPreferenceValues } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

export const MINIMUM_DESKTOP_RENAMER_API_VERSION = "1.0.0";
export const STRUCTURED_DESKTOP_RENAMER_API_VERSION = "1.0.0";
export const DESKTOP_RENAMER_JSON_RPC_VERSION = "2.0";
const SUPPORTED_DESKTOP_RENAMER_API_MAJOR = 1;
const MAX_STRUCTURED_PAYLOAD_BYTES = 1_048_576;

let installedApplicationLookup: Promise<boolean> | null = null;
const execFileAsync = promisify(execFile);
const SPACE_API_COMMAND_NOTIFICATION = "com.michaelqiu.DesktopRenamer.PerformCommand";
const SPACE_API_RESULT_NOTIFICATION = "com.michaelqiu.DesktopRenamer.CommandResult";
export const SPACE_API_RPC_REQUEST_NOTIFICATION = "com.michaelqiu.DesktopRenamer.RPCRequest";
export const SPACE_API_RPC_RESPONSE_NOTIFICATION = "com.michaelqiu.DesktopRenamer.RPCResponse";
export const SPACE_API_RPC_EVENT_NOTIFICATION = "com.michaelqiu.DesktopRenamer.RPCEvent";
export const SPACE_API_PAYLOAD_KEY = "payload";

export interface SpaceAPISpaceRecord {
  id: string;
  name: string;
  displayID: string;
  displayName: string;
  number: number;
  isFullscreen: boolean;
  appName?: string;
  appPath?: string;
  globalShortcutNumber?: number;
}

export interface SpaceAPISnapshot {
  apiVersion: string;
  revision: number;
  timestamp: string;
  currentSpaceIDs: string[];
  currentSpaceName: string;
  spaces: SpaceAPISpaceRecord[];
}

export interface SpaceAPIWindowRecord {
  id: number;
  pid: number;
  ownerName: string;
  appPath?: string;
  title?: string;
  spaceID: string;
  isMinimized: boolean;
  isHidden: boolean;
}

export interface SpaceAPIWindowsSnapshot {
  apiVersion: string;
  revision: number;
  timestamp: string;
  spaces: SpaceAPISpaceRecord[];
  windows: SpaceAPIWindowRecord[];
}

export interface SpaceAPIInfo {
  contractVersion: string;
  jsonRPCVersion: string;
  supportedMethods: string[];
  legacyNotifications: boolean;
  legacyCompatibility: string;
  eventNotifications: boolean;
  eventCapabilities: string[];
  maxPayloadBytes: number;
}

export interface SpaceAPIOperationResult {
  accepted: boolean;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCResponse {
  jsonrpc: string;
  id: string | null;
  result?: unknown;
  error?: JSONRPCError;
}

class SpaceAPIProtocolError extends Error {
  readonly code?: number;
  readonly data?: unknown;
  readonly canFallback: boolean;

  constructor(message: string, code?: number, data?: unknown, canFallback = false) {
    super(message);
    this.name = "SpaceAPIProtocolError";
    this.code = code;
    this.data = data;
    this.canFallback = canFallback;
  }
}

type CommunicationMethod = "automatic" | "spaceapi" | "applescript";

function communicationMethod(): CommunicationMethod {
  const value = getPreferenceValues<{ communicationMethod?: CommunicationMethod }>().communicationMethod;
  return value ?? "automatic";
}

export function escapeAppleScriptString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function isDesktopRenamerInstalled(): Promise<boolean> {
  if (!installedApplicationLookup) {
    installedApplicationLookup = getApplications()
      .then((applications) => applications.some((app) => app.bundleId === "com.michaelqiu.DesktopRenamer"))
      .then((isInstalled) => {
        if (!isInstalled) installedApplicationLookup = null;
        return isInstalled;
      })
      .catch((error) => {
        installedApplicationLookup = null;
        throw error;
      });
  }
  return installedApplicationLookup;
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
        const apiResult = await runSpaceAPIForScript(scriptContent, method === "spaceapi");
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

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolError(message: string, code = -32600, data?: unknown, canFallback = true): SpaceAPIProtocolError {
  return new SpaceAPIProtocolError(message, code, data, canFallback);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw protocolError(`Structured response field '${field}' must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field);
}

function requiredBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw protocolError(`Structured response field '${field}' must be a Boolean.`);
  }
  return value;
}

function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw protocolError(`Structured response field '${field}' must be a safe integer.`);
  }
  return value;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const integer = requiredInteger(value, field);
  if (integer <= 0) {
    throw protocolError(`Structured response field '${field}' must be a positive integer.`);
  }
  return integer;
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw protocolError(`Structured response field '${field}' must be an array of strings.`);
  }
  return value;
}

function validateContractVersion(version: string, minimumVersion = STRUCTURED_DESKTOP_RENAMER_API_VERSION): void {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  if (
    !Number.isInteger(major) ||
    major !== SUPPORTED_DESKTOP_RENAMER_API_MAJOR ||
    compareVersions(version, minimumVersion) < 0
  ) {
    throw protocolError(
      `DesktopRenamer structured API ${minimumVersion} or newer is required (found ${version}).`,
      -32005,
      { expected: minimumVersion, found: version },
      true,
    );
  }
}

function parseSpaceRecord(value: unknown, index: number): SpaceAPISpaceRecord {
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError(`Structured space at index ${index} must be an object.`);

  const appName = optionalString(record.appName, `spaces[${index}].appName`);
  const appPath = optionalString(record.appPath, `spaces[${index}].appPath`);
  const globalShortcutNumber =
    record.globalShortcutNumber === undefined || record.globalShortcutNumber === null
      ? undefined
      : requiredInteger(record.globalShortcutNumber, `spaces[${index}].globalShortcutNumber`);

  return {
    id: requiredString(record.id, `spaces[${index}].id`),
    name: requiredString(record.name, `spaces[${index}].name`),
    displayID: requiredString(record.displayID, `spaces[${index}].displayID`),
    displayName: requiredString(record.displayName, `spaces[${index}].displayName`),
    number: requiredInteger(record.number, `spaces[${index}].number`),
    isFullscreen: requiredBoolean(record.isFullscreen, `spaces[${index}].isFullscreen`),
    ...(appName === undefined ? {} : { appName }),
    ...(appPath === undefined ? {} : { appPath }),
    ...(globalShortcutNumber === undefined ? {} : { globalShortcutNumber }),
  };
}

function parseWindowRecord(value: unknown, index: number): SpaceAPIWindowRecord {
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError(`Structured window at index ${index} must be an object.`);

  const appPath = optionalString(record.appPath, `windows[${index}].appPath`);
  const title = optionalString(record.title, `windows[${index}].title`);
  return {
    id: requiredPositiveInteger(record.id, `windows[${index}].id`),
    pid: requiredPositiveInteger(record.pid, `windows[${index}].pid`),
    ownerName: requiredString(record.ownerName, `windows[${index}].ownerName`),
    spaceID: requiredString(record.spaceID, `windows[${index}].spaceID`),
    isMinimized: requiredBoolean(record.isMinimized, `windows[${index}].isMinimized`),
    isHidden: requiredBoolean(record.isHidden, `windows[${index}].isHidden`),
    ...(appPath === undefined ? {} : { appPath }),
    ...(title === undefined ? {} : { title }),
  };
}

function parseSnapshot(value: unknown): SpaceAPISnapshot {
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError("Structured space snapshot must be an object.");
  const apiVersion = requiredString(record.apiVersion, "apiVersion");
  validateContractVersion(apiVersion);
  if (!Array.isArray(record.spaces)) throw protocolError("Structured snapshot field 'spaces' must be an array.");

  return {
    apiVersion,
    revision: requiredInteger(record.revision, "revision"),
    timestamp: requiredString(record.timestamp, "timestamp"),
    currentSpaceIDs: requiredStringArray(record.currentSpaceIDs, "currentSpaceIDs"),
    currentSpaceName: requiredString(record.currentSpaceName, "currentSpaceName"),
    spaces: record.spaces.map(parseSpaceRecord),
  };
}

function parseWindowsSnapshot(value: unknown): SpaceAPIWindowsSnapshot {
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError("Structured window snapshot must be an object.");
  const apiVersion = requiredString(record.apiVersion, "apiVersion");
  validateContractVersion(apiVersion);
  if (!Array.isArray(record.spaces)) throw protocolError("Structured window snapshot field 'spaces' must be an array.");
  if (!Array.isArray(record.windows))
    throw protocolError("Structured window snapshot field 'windows' must be an array.");

  return {
    apiVersion,
    revision: requiredInteger(record.revision, "revision"),
    timestamp: requiredString(record.timestamp, "timestamp"),
    spaces: record.spaces.map(parseSpaceRecord),
    windows: record.windows.map(parseWindowRecord),
  };
}

function parseAPIInfo(value: unknown): SpaceAPIInfo {
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError("Structured API information must be an object.");
  const contractVersion = requiredString(record.contractVersion, "contractVersion");
  validateContractVersion(contractVersion);
  const jsonRPCVersion = requiredString(record.jsonRPCVersion, "jsonRPCVersion");
  if (jsonRPCVersion !== DESKTOP_RENAMER_JSON_RPC_VERSION) {
    throw protocolError(`Unsupported JSON-RPC version: ${jsonRPCVersion}.`, -32600, undefined, true);
  }
  return {
    contractVersion,
    jsonRPCVersion,
    supportedMethods: requiredStringArray(record.supportedMethods, "supportedMethods"),
    legacyNotifications: requiredBoolean(record.legacyNotifications, "legacyNotifications"),
    legacyCompatibility: requiredString(record.legacyCompatibility, "legacyCompatibility"),
    eventNotifications: requiredBoolean(record.eventNotifications, "eventNotifications"),
    eventCapabilities: requiredStringArray(record.eventCapabilities, "eventCapabilities"),
    maxPayloadBytes: requiredInteger(record.maxPayloadBytes, "maxPayloadBytes"),
  };
}

function parseStructuredPayload(payload: string): unknown {
  if (Buffer.byteLength(payload, "utf8") > MAX_STRUCTURED_PAYLOAD_BYTES) {
    throw protocolError("Structured SpaceAPI payload exceeds the maximum size.", -32006, undefined, true);
  }
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw protocolError("Structured SpaceAPI response is not valid JSON.", -32700, undefined, true);
  }
}

export function decodeSpaceSnapshotJSON(payload: string): SpaceAPISnapshot {
  return parseSnapshot(parseStructuredPayload(payload));
}

export function decodeWindowsSnapshotJSON(payload: string): SpaceAPIWindowsSnapshot {
  return parseWindowsSnapshot(parseStructuredPayload(payload));
}

export function decodeStructuredAPIInfo(value: unknown): SpaceAPIInfo {
  return parseAPIInfo(value);
}

export function decodeStructuredRPCResponse(payload: string, expectedID: string): JSONRPCResponse {
  const value = parseStructuredPayload(payload);
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError("Structured SpaceAPI response must be an object.");
  if (record.jsonrpc !== DESKTOP_RENAMER_JSON_RPC_VERSION) {
    throw protocolError("Structured SpaceAPI response is not JSON-RPC 2.0.");
  }
  if (typeof record.id !== "string" || record.id.length === 0 || record.id !== expectedID) {
    throw protocolError("Structured SpaceAPI response ID did not match the request.", -32007, undefined, true);
  }

  const hasResult = Object.prototype.hasOwnProperty.call(record, "result");
  const hasError = Object.prototype.hasOwnProperty.call(record, "error");
  if (hasResult === hasError) {
    throw protocolError("Structured SpaceAPI response must contain exactly one of result or error.");
  }
  if (hasError) {
    const error = isRecord(record.error) ? record.error : undefined;
    if (
      !error ||
      !Number.isSafeInteger(error.code) ||
      typeof error.message !== "string" ||
      error.message.length === 0
    ) {
      throw protocolError("Structured SpaceAPI error is malformed.");
    }
    const errorCode = error.code as number;
    const errorMessage = error.message as string;
    throw new SpaceAPIProtocolError(`${errorMessage} (code ${errorCode})`, errorCode, error.data, errorCode === -32601);
  }
  return {
    jsonrpc: DESKTOP_RENAMER_JSON_RPC_VERSION,
    id: expectedID,
    result: record.result,
  };
}

function validateStructuredResult(method: string, result: unknown): unknown {
  switch (method) {
    case "getAPIInfo":
      return parseAPIInfo(result);
    case "getAPIVersion": {
      const version = requiredString(result, "result");
      validateContractVersion(version);
      return version;
    }
    case "getSpaceSnapshot":
      return parseSnapshot(result);
    case "getWindows":
      return parseWindowsSnapshot(result);
    case "getAllSpaces": {
      const record = isRecord(result) ? result : undefined;
      if (!record || !Array.isArray(record.spaces)) throw protocolError("Structured spaces result is malformed.");
      return { ...record, spaces: record.spaces.map(parseSpaceRecord) };
    }
    case "getCurrentSpaceName":
      return requiredString(result, "result");
    case "getCurrentSpaceID":
      return requiredStringArray(result, "result");
    case "toggleMenubar":
    case "toggleLauncher":
    case "toggleLabels":
    case "toggleActiveLabel":
    case "togglePreviewLabel":
    case "toggleDesktopVisibility":
      return requiredBoolean(result, "result");
    default: {
      const operation = isRecord(result) ? result : undefined;
      if (!operation || typeof operation.accepted !== "boolean") {
        throw protocolError("Structured operation result is malformed.");
      }
      return { accepted: operation.accepted } satisfies SpaceAPIOperationResult;
    }
  }
}

export async function runDesktopRenamerCommand(command: string, errorMessage = "Is DesktopRenamer running?") {
  if (!(await isDesktopRenamerInstalled())) {
    const error = new Error("NotInstalled");
    await handleDesktopRenamerError(error, errorMessage);
    throw error;
  }

  const method = communicationMethod();
  if (method !== "applescript") {
    try {
      const apiCommand = parseSpaceAPICommand(command);
      if (apiCommand) {
        return await runSpaceAPICommand(apiCommand.name, apiCommand.arguments, method === "spaceapi");
      }
    } catch (error) {
      if (method === "spaceapi") {
        await handleDesktopRenamerError(error, errorMessage);
        throw error;
      }
    }
  }
  return await runDesktopRenamerScript(`tell application "DesktopRenamer" to ${command}`, errorMessage);
}

export interface CurrentSpaceSnapshot {
  spacesByDisplay: Record<string, string>;
}

const SPACE_SWITCH_POLL_INTERVAL_MS = 100;
const SPACE_SWITCH_TIMEOUT_MS = 2000;

export async function getCurrentSpacesByDisplay(): Promise<CurrentSpaceSnapshot> {
  const result = await runDesktopRenamerScript(`
    tell application "DesktopRenamer"
      set allSpaces to get all spaces
      set currentName to get current space name
      set currentId to get current space id
      return allSpaces & "~~~" & currentName & "~~~" & currentId
    end tell
  `);

  if (result.trimStart().startsWith("{")) {
    const snapshot = decodeSpaceSnapshotJSON(result);
    const spacesByID = new Map(snapshot.spaces.map((space) => [space.id, space.displayID]));
    return {
      spacesByDisplay: Object.fromEntries(
        snapshot.currentSpaceIDs.flatMap((spaceID) => {
          const displayID = spacesByID.get(spaceID);
          return displayID ? [[displayID, spaceID]] : [];
        }),
      ),
    };
  }

  const [, , currentIDs] = result.split("~~~");
  const ids = (currentIDs ?? "")
    .split(",")
    .map((spaceID) => spaceID.trim())
    .filter(Boolean);
  return { spacesByDisplay: Object.fromEntries(ids.map((spaceID, index) => [`display-${index}`, spaceID])) };
}

export async function restoreSpacesByDisplay(snapshot: CurrentSpaceSnapshot): Promise<void> {
  let currentSpaces: CurrentSpaceSnapshot | undefined;
  try {
    currentSpaces = await getCurrentSpacesByDisplay();
  } catch {
    // The restore itself remains authoritative if the read-back is unavailable.
  }

  for (const [displayID, spaceID] of Object.entries(snapshot.spacesByDisplay)) {
    if (currentSpaces?.spacesByDisplay[displayID] === spaceID) continue;

    await runDesktopRenamerCommand(`switch to space "${escapeAppleScriptString(spaceID)}"`);
    await waitForSpaceToBecomeCurrent(spaceID);
  }
}

export async function focusWindowOnSpace(windowID: number, pid: number, spaceID: string): Promise<void> {
  await runDesktopRenamerCommand(`switch to space "${escapeAppleScriptString(spaceID)}"`);
  await waitForSpaceToBecomeCurrent(spaceID);
  await runDesktopRenamerCommand(`focus window ${windowID} pid ${pid}`);
}

async function waitForSpaceToBecomeCurrent(spaceID: string): Promise<void> {
  const deadline = Date.now() + SPACE_SWITCH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const currentSpaces = await getCurrentSpacesByDisplay();
      if (Object.values(currentSpaces.spacesByDisplay).includes(spaceID)) return;
    } catch {
      // Keep polling. The space switch may still be settling, and the next
      // read can succeed after Mission Control finishes updating its state.
    }

    await new Promise((resolve) => setTimeout(resolve, SPACE_SWITCH_POLL_INTERVAL_MS));
  }

  throw new Error(`DesktopRenamer did not activate space ${spaceID} in time.`);
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

async function runSpaceAPIForScript(scriptContent: string, fallbackToLegacy: boolean): Promise<string | null> {
  if (scriptContent.includes("get windows")) {
    return await runSpaceAPICommand("getWindows", {}, fallbackToLegacy);
  }
  if (scriptContent.includes("get all spaces") && scriptContent.includes("get current space name")) {
    return await runSpaceAPICommand("getSpaceSnapshot", {}, fallbackToLegacy);
  }
  return null;
}

async function runSpaceAPICommand(
  command: string,
  arguments_: Record<string, string>,
  fallbackToLegacy: boolean,
): Promise<string> {
  try {
    const result = await runStructuredSpaceAPICommand(command, arguments_);
    return stringifyStructuredResult(command, result);
  } catch (error) {
    if (fallbackToLegacy && error instanceof SpaceAPIProtocolError && error.canFallback) {
      return await runLegacySpaceAPICommand(command, arguments_);
    }
    throw error;
  }
}

function stringifyStructuredResult(command: string, result: unknown): string {
  if (command === "getCurrentSpaceID" && Array.isArray(result)) {
    return result.join(",");
  }
  if (typeof result === "string") return result;
  if (typeof result === "boolean" || typeof result === "number") return String(result);
  return JSON.stringify(result) ?? "";
}

function makeStructuredParameters(arguments_: Record<string, string>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(arguments_).map(([key, value]) => {
      if (key === "windowID" || key === "pid") return [key, Number(value)];
      return [key, value];
    }),
  );
}

export async function runStructuredSpaceAPICommand(
  command: string,
  arguments_: Record<string, string> = {},
): Promise<unknown> {
  const requestID = randomUUID();
  const timeoutMs = [
    "getAPIVersion",
    "getCurrentSpaceName",
    "getCurrentSpaceID",
    "getAllSpaces",
    "getSpaceSnapshot",
  ].includes(command)
    ? 3000
    : 10000;
  const script = makeStructuredSpaceAPIJXA(requestID, command, makeStructuredParameters(arguments_), timeoutMs);

  try {
    const { stdout, stderr } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = (stdout.trim() ? stdout : stderr).trimEnd();
    if (!output) throw new Error("DesktopRenamer returned an empty structured response.");
    const response = decodeStructuredRPCResponse(output, requestID);
    return validateStructuredResult(command, response.result);
  } catch (error) {
    if (error instanceof SpaceAPIProtocolError) throw error;
    throw protocolError(
      error instanceof Error ? error.message : "Structured SpaceAPI request failed.",
      undefined,
      undefined,
      true,
    );
  }
}

async function runLegacySpaceAPICommand(command: string, arguments_: Record<string, string>): Promise<string> {
  const requestID = randomUUID();
  const timeoutMs = [
    "getAPIVersion",
    "getCurrentSpaceName",
    "getCurrentSpaceID",
    "getAllSpaces",
    "getSpaceSnapshot",
  ].includes(command)
    ? 3000
    : 10000;
  const script = makeLegacySpaceAPIJXA(requestID, command, arguments_, timeoutMs);
  const { stdout, stderr } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = (stdout.trim() ? stdout : stderr).trimEnd();
  const response = JSON.parse(output) as { apiVersion?: string; result?: string };
  if (response.apiVersion) {
    const apiMajor = Number.parseInt(response.apiVersion.split(".")[0] ?? "", 10);
    if (
      compareVersions(response.apiVersion, MINIMUM_DESKTOP_RENAMER_API_VERSION) < 0 ||
      apiMajor !== SUPPORTED_DESKTOP_RENAMER_API_MAJOR
    ) {
      throw new Error(
        `DesktopRenamer API major version ${SUPPORTED_DESKTOP_RENAMER_API_MAJOR} is required (found ${response.apiVersion})`,
      );
    }
  }
  return response.result ?? "";
}

function makeStructuredSpaceAPIJXA(
  requestID: string,
  command: string,
  arguments_: Record<string, string | number>,
  timeoutMs: number,
): string {
  const requestObject: {
    jsonrpc: string;
    id: string;
    method: string;
    params?: Record<string, string | number>;
  } = {
    jsonrpc: DESKTOP_RENAMER_JSON_RPC_VERSION,
    id: requestID,
    method: command,
  };
  if (Object.keys(arguments_).length > 0) requestObject.params = arguments_;
  const requestPayload = JSON.stringify(requestObject);

  return `
ObjC.import('Foundation');
const requestID = ${JSON.stringify(requestID)};
const requestPayload = ${JSON.stringify(requestPayload)};
const center = $.NSDistributedNotificationCenter.defaultCenter;
const responseName = '${SPACE_API_RPC_RESPONSE_NOTIFICATION}';
let responsePayload = null;
let finished = false;
const observer = center.addObserverForNameObjectQueueUsingBlock(
  responseName,
  undefined,
  undefined,
  function(notification) {
    const info = ObjC.unwrap(notification.userInfo);
    const payload = info ? ObjC.unwrap(info.payload) : undefined;
    if (payload) {
      try {
        const candidate = JSON.parse(String(payload));
        if (candidate && candidate.id === requestID) {
          responsePayload = String(payload);
          finished = true;
        }
      } catch (_) {
        // Leave malformed or unrelated broadcasts for the correlated request to reject.
      }
    }
  }
);
const userInfo = $.NSMutableDictionary.dictionary;
userInfo.setObjectForKey(requestPayload, '${SPACE_API_PAYLOAD_KEY}');
center.postNotificationNameObjectUserInfoDeliverImmediately('${SPACE_API_RPC_REQUEST_NOTIFICATION}', undefined, userInfo, true);
const deadline = Date.now() + ${timeoutMs};
while (!finished && Date.now() < deadline) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.01));
}
center.removeObserver(observer);
if (!responsePayload) throw new Error('Structured SpaceAPI request timed out.');
console.log(responsePayload);
`;
}

function makeLegacySpaceAPIJXA(
  requestID: string,
  command: string,
  arguments_: Record<string, string>,
  timeoutMs: number,
): string {
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
const deadline = Date.now() + ${timeoutMs};
while (!finished && Date.now() < deadline) {
  $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.01));
}
center.removeObserver(observer);
if (!response) throw new Error('SpaceAPI request timed out.');
const success = ObjC.unwrap(response.success);
if (!(success === true || String(success) === 'true' || String(success) === '1')) {
  const error = ObjC.unwrap(response.error);
  throw new Error(String(error || 'SpaceAPI command failed.'));
}
const result = ObjC.unwrap(response.result);
const apiVersion = ObjC.unwrap(response.apiVersion);
console.log(JSON.stringify({apiVersion: apiVersion || null, result: result || ''}));
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
