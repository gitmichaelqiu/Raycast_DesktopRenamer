import { showToast, Toast, open, environment, LaunchType, getApplications, getPreferenceValues } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

export const MINIMUM_DESKTOP_RENAMER_API_VERSION = "1.0.0";
export const STRUCTURED_DESKTOP_RENAMER_API_VERSION = MINIMUM_DESKTOP_RENAMER_API_VERSION;
export const DESKTOP_RENAMER_JSON_RPC_VERSION = "2.0";
const SUPPORTED_DESKTOP_RENAMER_API_MAJOR = 1;
const MAX_STRUCTURED_PAYLOAD_BYTES = 1_048_576;
const READ_REQUEST_TIMEOUT_MS = 3_000;
const OPERATION_REQUEST_TIMEOUT_MS = 10_000;

export type SpaceAPIMethod =
  | "getAPIInfo"
  | "getAPIVersion"
  | "getSpaceSnapshot"
  | "getCurrentSpaceName"
  | "getCurrentSpaceID"
  | "getAllSpaces"
  | "switchToSpace"
  | "renameCurrentSpace"
  | "renameSpace"
  | "rearrangeSpace"
  | "moveWindowNext"
  | "moveWindowPrevious"
  | "moveWindowToSpace"
  | "reloadSpaceLabels"
  | "toggleMenubar"
  | "toggleLauncher"
  | "toggleLabels"
  | "toggleActiveLabel"
  | "togglePreviewLabel"
  | "toggleDesktopVisibility"
  | "getWindows"
  | "focusWindow"
  | "executeWindowAction"
  | "moveSpecificWindow";

export type SpaceAPIParameters = Record<string, string | number>;

export type EmptySpaceAPIParameters = Record<string, never>;

export const SPACE_API_WINDOW_ACTIONS = [
  "close",
  "minimize",
  "hide",
  "enterFullScreen",
  "exitFullScreen",
  "quit",
  "restore",
] as const;

export type SpaceAPIWindowAction = (typeof SPACE_API_WINDOW_ACTIONS)[number];

type SpaceAPIParameterKind = "string" | "positiveInteger" | "direction" | "windowAction";

interface SpaceAPIMethodDefinition {
  parameters: Record<string, SpaceAPIParameterKind>;
  required: readonly string[];
}

export interface SpaceAPIMethodArguments {
  getAPIInfo: EmptySpaceAPIParameters;
  getAPIVersion: EmptySpaceAPIParameters;
  getSpaceSnapshot: EmptySpaceAPIParameters;
  getCurrentSpaceName: EmptySpaceAPIParameters;
  getCurrentSpaceID: EmptySpaceAPIParameters;
  getAllSpaces: EmptySpaceAPIParameters;
  switchToSpace: { spaceID: string };
  renameCurrentSpace: { name: string };
  renameSpace: { spaceID: string; name: string };
  rearrangeSpace: { spaceID: string; direction: "up" | "down" };
  moveWindowNext: EmptySpaceAPIParameters;
  moveWindowPrevious: EmptySpaceAPIParameters;
  moveWindowToSpace: { spaceID: string };
  reloadSpaceLabels: EmptySpaceAPIParameters;
  toggleMenubar: EmptySpaceAPIParameters;
  toggleLauncher: EmptySpaceAPIParameters;
  toggleLabels: EmptySpaceAPIParameters;
  toggleActiveLabel: EmptySpaceAPIParameters;
  togglePreviewLabel: EmptySpaceAPIParameters;
  toggleDesktopVisibility: EmptySpaceAPIParameters;
  getWindows: EmptySpaceAPIParameters;
  focusWindow: { windowID: number; pid: number };
  executeWindowAction: { windowID: number; pid: number; action: SpaceAPIWindowAction };
  moveSpecificWindow: { windowID: number; pid?: number; fromSpaceID: string; targetSpaceID: string };
}

export const SPACE_API_ERROR_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  apiDisabled: -32001,
  appUnavailable: -32002,
  operationFailed: -32004,
  unsupportedContract: -32005,
  payloadTooLarge: -32006,
  responseMismatch: -32007,
} as const;

const SPACE_API_METHOD_DEFINITIONS: Record<SpaceAPIMethod, SpaceAPIMethodDefinition> = {
  getAPIInfo: { parameters: {}, required: [] },
  getAPIVersion: { parameters: {}, required: [] },
  getSpaceSnapshot: { parameters: {}, required: [] },
  getCurrentSpaceName: { parameters: {}, required: [] },
  getCurrentSpaceID: { parameters: {}, required: [] },
  getAllSpaces: { parameters: {}, required: [] },
  switchToSpace: { parameters: { spaceID: "string" }, required: ["spaceID"] },
  renameCurrentSpace: { parameters: { name: "string" }, required: ["name"] },
  renameSpace: {
    parameters: { spaceID: "string", name: "string" },
    required: ["spaceID", "name"],
  },
  rearrangeSpace: {
    parameters: { spaceID: "string", direction: "direction" },
    required: ["spaceID", "direction"],
  },
  moveWindowNext: { parameters: {}, required: [] },
  moveWindowPrevious: { parameters: {}, required: [] },
  moveWindowToSpace: { parameters: { spaceID: "string" }, required: ["spaceID"] },
  reloadSpaceLabels: { parameters: {}, required: [] },
  toggleMenubar: { parameters: {}, required: [] },
  toggleLauncher: { parameters: {}, required: [] },
  toggleLabels: { parameters: {}, required: [] },
  toggleActiveLabel: { parameters: {}, required: [] },
  togglePreviewLabel: { parameters: {}, required: [] },
  toggleDesktopVisibility: { parameters: {}, required: [] },
  getWindows: { parameters: {}, required: [] },
  focusWindow: {
    parameters: { windowID: "positiveInteger", pid: "positiveInteger" },
    required: ["windowID", "pid"],
  },
  executeWindowAction: {
    parameters: { windowID: "positiveInteger", pid: "positiveInteger", action: "windowAction" },
    required: ["windowID", "pid", "action"],
  },
  moveSpecificWindow: {
    parameters: {
      windowID: "positiveInteger",
      pid: "positiveInteger",
      fromSpaceID: "string",
      targetSpaceID: "string",
    },
    required: ["windowID", "fromSpaceID", "targetSpaceID"],
  },
};

const STRUCTURED_READ_METHODS = new Set<SpaceAPIMethod>([
  "getAPIInfo",
  "getAPIVersion",
  "getSpaceSnapshot",
  "getCurrentSpaceName",
  "getCurrentSpaceID",
  "getAllSpaces",
  "getWindows",
]);

let installedApplicationLookup: Promise<boolean> | null = null;
let structuredAPIInfoLookup: Promise<SpaceAPIInfo> | null = null;
let structuredAPIMaxPayloadBytes = MAX_STRUCTURED_PAYLOAD_BYTES;
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
  appName: string | null;
  appPath: string | null;
  globalShortcutNumber: number | null;
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
  appPath: string | null;
  title: string | null;
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

export interface SpaceAPIWindowSpaceRecord {
  id: string;
  name: string;
  displayID: string;
  num: number;
  isFullscreen: boolean;
}

export interface SpaceAPIWindowEntry {
  windowID: number;
  pid: number;
  ownerName: string;
  appPath: string;
  title: string;
  space: SpaceAPIWindowSpaceRecord;
  isMinimized: boolean;
  isHidden: boolean;
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

export interface SpaceAPIMethodResults {
  getAPIInfo: SpaceAPIInfo;
  getAPIVersion: string;
  getSpaceSnapshot: SpaceAPISnapshot;
  getCurrentSpaceName: string;
  getCurrentSpaceID: string[];
  getAllSpaces: SpaceAPISpaceRecord[];
  switchToSpace: SpaceAPIOperationResult;
  renameCurrentSpace: SpaceAPIOperationResult;
  renameSpace: SpaceAPIOperationResult;
  rearrangeSpace: SpaceAPIOperationResult;
  moveWindowNext: SpaceAPIOperationResult;
  moveWindowPrevious: SpaceAPIOperationResult;
  moveWindowToSpace: SpaceAPIOperationResult;
  reloadSpaceLabels: SpaceAPIOperationResult;
  toggleMenubar: boolean;
  toggleLauncher: boolean;
  toggleLabels: boolean;
  toggleActiveLabel: boolean;
  togglePreviewLabel: boolean;
  toggleDesktopVisibility: boolean;
  getWindows: SpaceAPIWindowsSnapshot;
  focusWindow: SpaceAPIOperationResult;
  executeWindowAction: SpaceAPIOperationResult;
  moveSpecificWindow: SpaceAPIOperationResult;
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

export interface JSONRPCEvent {
  jsonrpc: string;
  method: string;
  params: Record<string, unknown>;
}

export interface SpaceAPIStateChangedEvent {
  jsonrpc: string;
  method: "stateChanged";
  reason: string;
  snapshot: SpaceAPISnapshot;
}

export class SpaceAPIProtocolError extends Error {
  readonly code: number;
  readonly data?: unknown;
  readonly canFallback: boolean;

  constructor(
    message: string,
    code: number = SPACE_API_ERROR_CODES.invalidRequest,
    data?: unknown,
    canFallback = false,
  ) {
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
  return value === "spaceapi" || value === "applescript" ? value : "automatic";
}

export function escapeAppleScriptString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
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

async function requireDesktopRenamerInstalled(): Promise<void> {
  if (!(await isDesktopRenamerInstalled())) throw new Error("NotInstalled");
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
    } else if (
      (error instanceof SpaceAPIProtocolError && error.code === SPACE_API_ERROR_CODES.apiDisabled) ||
      (error instanceof Error && error.message.includes("API Disabled"))
    ) {
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
    await requireDesktopRenamerInstalled();

    if (method === "applescript") {
      const isRunning = await checkDesktopRenamerRunning();
      if (!isRunning) {
        throw new Error("NotRunning");
      }
    }
    if (method !== "applescript") {
      try {
        const apiResult = await runSpaceAPIForScript(scriptContent);
        if (apiResult !== null) return apiResult;
      } catch (error) {
        if (method === "spaceapi" || !(error instanceof SpaceAPIProtocolError && error.canFallback)) {
          throw error;
        }
      }
    }
    return await runAppleScript(scriptContent);
  } catch (error) {
    await handleDesktopRenamerError(error, errorMessage);
    throw error;
  }
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return Number.NaN;
  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part));
  const [major, minor, patch] = parts;
  if (
    major === undefined ||
    minor === undefined ||
    patch === undefined ||
    [major, minor, patch].some((part) => !Number.isSafeInteger(part) || part < 0)
  ) {
    return null;
  }
  return [major, minor, patch];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolError(
  message: string,
  code: number = SPACE_API_ERROR_CODES.invalidRequest,
  data?: unknown,
  canFallback = true,
): SpaceAPIProtocolError {
  return new SpaceAPIProtocolError(message, code, data, canFallback);
}

function isReadSpaceAPIMethod(method: string): boolean {
  return STRUCTURED_READ_METHODS.has(method as SpaceAPIMethod);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw protocolError(`Structured response field '${field}' must be a non-empty string.`);
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
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

function requiredNonNegativeInteger(value: unknown, field: string): number {
  const integer = requiredInteger(value, field);
  if (integer < 0) {
    throw protocolError(`Structured response field '${field}' must be non-negative.`);
  }
  return integer;
}

function requiredPositiveInteger(value: unknown, field: string): number {
  const integer = requiredInteger(value, field);
  if (integer <= 0) {
    throw protocolError(`Structured response field '${field}' must be a positive integer.`);
  }
  return integer;
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw protocolError(`Structured response field '${field}' must be an array of strings.`);
  }
  return value;
}

function validateContractVersion(version: string, minimumVersion = STRUCTURED_DESKTOP_RENAMER_API_VERSION): void {
  const parsedVersion = parseVersion(version);
  const minimum = parseVersion(minimumVersion);
  if (
    !parsedVersion ||
    !minimum ||
    parsedVersion[0] !== SUPPORTED_DESKTOP_RENAMER_API_MAJOR ||
    compareVersions(version, minimumVersion) < 0
  ) {
    throw protocolError(
      `DesktopRenamer structured API ${minimumVersion} or newer is required (found ${version}).`,
      SPACE_API_ERROR_CODES.unsupportedContract,
      { expected: minimumVersion, found: version },
      true,
    );
  }
}

function parseSpaceRecord(value: unknown, index: number): SpaceAPISpaceRecord {
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError(`Structured space at index ${index} must be an object.`);

  const appName = nullableString(record.appName, `spaces[${index}].appName`);
  const appPath = nullableString(record.appPath, `spaces[${index}].appPath`);
  const globalShortcutNumber =
    record.globalShortcutNumber === undefined || record.globalShortcutNumber === null
      ? null
      : requiredNonNegativeInteger(record.globalShortcutNumber, `spaces[${index}].globalShortcutNumber`);

  return {
    id: requiredString(record.id, `spaces[${index}].id`),
    name: requiredString(record.name, `spaces[${index}].name`),
    displayID: requiredString(record.displayID, `spaces[${index}].displayID`),
    displayName: requiredString(record.displayName, `spaces[${index}].displayName`),
    number: requiredNonNegativeInteger(record.number, `spaces[${index}].number`),
    isFullscreen: requiredBoolean(record.isFullscreen, `spaces[${index}].isFullscreen`),
    appName,
    appPath,
    globalShortcutNumber,
  };
}

function parseWindowRecord(value: unknown, index: number): SpaceAPIWindowRecord {
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError(`Structured window at index ${index} must be an object.`);

  const appPath = nullableString(record.appPath, `windows[${index}].appPath`);
  const title = nullableString(record.title, `windows[${index}].title`);
  return {
    id: requiredPositiveInteger(record.id, `windows[${index}].id`),
    pid: requiredPositiveInteger(record.pid, `windows[${index}].pid`),
    ownerName: requiredString(record.ownerName, `windows[${index}].ownerName`),
    spaceID: requiredString(record.spaceID, `windows[${index}].spaceID`),
    isMinimized: requiredBoolean(record.isMinimized, `windows[${index}].isMinimized`),
    isHidden: requiredBoolean(record.isHidden, `windows[${index}].isHidden`),
    appPath,
    title,
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
    revision: requiredNonNegativeInteger(record.revision, "revision"),
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
    revision: requiredNonNegativeInteger(record.revision, "revision"),
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
    throw protocolError(
      `Unsupported JSON-RPC version: ${jsonRPCVersion}.`,
      SPACE_API_ERROR_CODES.invalidRequest,
      undefined,
      true,
    );
  }
  const supportedMethods = requiredStringArray(record.supportedMethods, "supportedMethods");
  if (!supportedMethods.includes("getAPIInfo") || new Set(supportedMethods).size !== supportedMethods.length) {
    throw protocolError("Structured API information must advertise a unique getAPIInfo method.");
  }
  const maxPayloadBytes = requiredPositiveInteger(record.maxPayloadBytes, "maxPayloadBytes");
  const legacyNotifications = requiredBoolean(record.legacyNotifications, "legacyNotifications");
  const legacyCompatibility = requiredString(record.legacyCompatibility, "legacyCompatibility");
  const eventNotifications = requiredBoolean(record.eventNotifications, "eventNotifications");
  const eventCapabilities = requiredStringArray(record.eventCapabilities, "eventCapabilities");
  if (new Set(eventCapabilities).size !== eventCapabilities.length) {
    throw protocolError("Structured API information must advertise unique event capabilities.");
  }
  if (!eventNotifications && eventCapabilities.length > 0) {
    throw protocolError("Structured API information cannot advertise event capabilities when events are disabled.");
  }
  return {
    contractVersion,
    jsonRPCVersion,
    supportedMethods,
    legacyNotifications,
    legacyCompatibility,
    eventNotifications,
    eventCapabilities,
    maxPayloadBytes,
  };
}

function parseStructuredPayload(payload: string, maxPayloadBytes = MAX_STRUCTURED_PAYLOAD_BYTES): unknown {
  if (Buffer.byteLength(payload, "utf8") > maxPayloadBytes) {
    throw protocolError(
      "Structured SpaceAPI payload exceeds the maximum size.",
      SPACE_API_ERROR_CODES.payloadTooLarge,
      undefined,
      true,
    );
  }
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    throw protocolError(
      "Structured SpaceAPI response is not valid JSON.",
      SPACE_API_ERROR_CODES.parseError,
      undefined,
      true,
    );
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
  const value = parseStructuredPayload(payload, structuredAPIMaxPayloadBytes);
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError("Structured SpaceAPI response must be an object.");
  if (record.jsonrpc !== DESKTOP_RENAMER_JSON_RPC_VERSION) {
    throw protocolError("Structured SpaceAPI response is not JSON-RPC 2.0.");
  }
  if (typeof record.id !== "string" || record.id.length === 0 || record.id !== expectedID) {
    throw protocolError(
      "Structured SpaceAPI response ID did not match the request.",
      SPACE_API_ERROR_CODES.responseMismatch,
      undefined,
      true,
    );
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
    throw new SpaceAPIProtocolError(
      `${errorMessage} (code ${errorCode})`,
      errorCode,
      error.data,
      errorCode === SPACE_API_ERROR_CODES.methodNotFound || errorCode === SPACE_API_ERROR_CODES.unsupportedContract,
    );
  }
  return {
    jsonrpc: DESKTOP_RENAMER_JSON_RPC_VERSION,
    id: expectedID,
    result: record.result,
  };
}

export function decodeStructuredRPCEvent(payload: string): JSONRPCEvent {
  const value = parseStructuredPayload(payload, structuredAPIMaxPayloadBytes);
  const record = isRecord(value) ? value : undefined;
  if (!record) throw protocolError("Structured SpaceAPI event must be an object.");
  if (record.jsonrpc !== DESKTOP_RENAMER_JSON_RPC_VERSION) {
    throw protocolError("Structured SpaceAPI event is not JSON-RPC 2.0.");
  }
  if (Object.prototype.hasOwnProperty.call(record, "id")) {
    throw protocolError("Structured SpaceAPI events must not contain an ID.");
  }
  const method = requiredString(record.method, "method");
  if (method.length > 128) {
    throw protocolError("Structured SpaceAPI event method must be at most 128 characters.");
  }
  const params = isRecord(record.params) ? record.params : undefined;
  if (!params) throw protocolError("Structured SpaceAPI event parameters must be an object.");
  return { jsonrpc: DESKTOP_RENAMER_JSON_RPC_VERSION, method, params };
}

export function decodeSpaceAPIStateChangedEvent(payload: string): SpaceAPIStateChangedEvent {
  const event = decodeStructuredRPCEvent(payload);
  if (event.method !== "stateChanged") {
    throw protocolError(`Unsupported SpaceAPI event method '${event.method}'.`);
  }
  const reason = requiredString(event.params.reason, "params.reason");
  return {
    jsonrpc: event.jsonrpc,
    method: "stateChanged",
    reason,
    snapshot: parseSnapshot(event.params.snapshot),
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
      if (Array.isArray(result)) return result.map(parseSpaceRecord);
      if (!record || !Array.isArray(record.spaces)) throw protocolError("Structured spaces result is malformed.");
      return record.spaces.map(parseSpaceRecord);
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
  try {
    await requireDesktopRenamerInstalled();
  } catch (error) {
    await handleDesktopRenamerError(error, errorMessage);
    throw error;
  }

  const method = communicationMethod();
  if (method !== "applescript") {
    const apiCommand = parseSpaceAPICommand(command);
    try {
      if (apiCommand) {
        // This function is the legacy raw-command compatibility helper. Keep
        // its delimiter/string result shape stable; typed callers should use
        // runDesktopRenamerMethod instead.
        const parameters = normalizeMethodArguments(apiCommand.name, apiCommand.arguments);
        return await runLegacySpaceAPICommand(apiCommand.name, stringifyLegacyParameters(parameters));
      }
    } catch (error) {
      if (
        method === "spaceapi" ||
        !apiCommand ||
        !isReadSpaceAPIMethod(apiCommand.name) ||
        !(error instanceof SpaceAPIProtocolError && error.canFallback)
      ) {
        await handleDesktopRenamerError(error, errorMessage);
        throw error;
      }
      try {
        return await runAppleScript(`tell application "DesktopRenamer" to ${command}`);
      } catch (scriptError) {
        await handleDesktopRenamerError(scriptError, errorMessage);
        throw scriptError;
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
  const snapshot = await getSpaceSnapshot();
  const spacesByID = new Map(snapshot.spaces.map((space) => [space.id, space.displayID]));
  const spacesByDisplay: Record<string, string> = {};
  snapshot.currentSpaceIDs.forEach((spaceID, index) => {
    spacesByDisplay[spacesByID.get(spaceID) ?? `display-${index}`] = spaceID;
  });
  return { spacesByDisplay };
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

    await switchToSpace(spaceID);
    await waitForSpaceToBecomeCurrent(spaceID);
  }
}

export async function focusWindowOnSpace(windowID: number, pid: number, spaceID: string): Promise<void> {
  await switchToSpace(spaceID);
  await waitForSpaceToBecomeCurrent(spaceID);
  await focusWindow(windowID, pid);
}

async function waitForSpaceToBecomeCurrent(spaceID: string): Promise<void> {
  const deadline = Date.now() + SPACE_SWITCH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const currentSpaceIDs = await getCurrentSpaceIDs();
      if (currentSpaceIDs.includes(spaceID)) return;
    } catch {
      // Keep polling. The space switch may still be settling, and the next
      // read can succeed after Mission Control finishes updating its state.
    }

    await new Promise((resolve) => setTimeout(resolve, SPACE_SWITCH_POLL_INTERVAL_MS));
  }

  throw new Error(`DesktopRenamer did not activate space ${spaceID} in time.`);
}

function parseSpaceAPICommand(command: string): { name: SpaceAPIMethod; arguments: Record<string, string> } | null {
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
  if (scriptContent.includes("get windows")) {
    return await runLegacySpaceAPICommand("getWindows", {});
  }
  if (scriptContent.includes("get all spaces") && scriptContent.includes("get current space name")) {
    return await runLegacySpaceAPICommand("getSpaceSnapshot", {});
  }
  return null;
}

async function runSpaceAPIMethod(
  command: SpaceAPIMethod,
  arguments_: SpaceAPIParameters,
  fallbackToLegacy: boolean,
): Promise<unknown> {
  let info: SpaceAPIInfo;
  try {
    info = await getStructuredAPIInfo();
  } catch (error) {
    if (fallbackToLegacy && error instanceof SpaceAPIProtocolError && error.canFallback) {
      return await runLegacySpaceAPICommand(command, stringifyLegacyParameters(arguments_));
    }
    throw error;
  }

  // getAPIInfo is the capability handshake itself. Reuse the cached result
  // instead of issuing a second identical request for the public helper.
  if (command === "getAPIInfo") return info;

  if (!info.supportedMethods.includes(command)) {
    if (fallbackToLegacy && info.legacyNotifications) {
      return await runLegacySpaceAPICommand(command, stringifyLegacyParameters(arguments_));
    }
    throw new SpaceAPIProtocolError(
      `DesktopRenamer does not support SpaceAPI method '${command}'.`,
      SPACE_API_ERROR_CODES.methodNotFound,
      { command },
      true,
    );
  }

  // Once getAPIInfo has succeeded, the structured server is authoritative. Do
  // not retry a request through another transport after an ambiguous response.
  return await runStructuredSpaceAPICommand(command, arguments_ as SpaceAPIMethodArguments[typeof command]);
}

async function getStructuredAPIInfo(): Promise<SpaceAPIInfo> {
  if (!structuredAPIInfoLookup) {
    structuredAPIMaxPayloadBytes = MAX_STRUCTURED_PAYLOAD_BYTES;
    structuredAPIInfoLookup = runStructuredSpaceAPICommand("getAPIInfo", {})
      .then((info) => {
        structuredAPIMaxPayloadBytes = Math.min(MAX_STRUCTURED_PAYLOAD_BYTES, info.maxPayloadBytes);
        return info;
      })
      .catch((error) => {
        structuredAPIInfoLookup = null;
        structuredAPIMaxPayloadBytes = MAX_STRUCTURED_PAYLOAD_BYTES;
        throw error;
      });
  }
  return await structuredAPIInfoLookup;
}

function stringifyLegacyParameters(arguments_: SpaceAPIParameters): Record<string, string> {
  return Object.fromEntries(Object.entries(arguments_).map(([key, value]) => [key, String(value)]));
}

function requestTimeout(command: SpaceAPIMethod): number {
  return STRUCTURED_READ_METHODS.has(command) ? READ_REQUEST_TIMEOUT_MS : OPERATION_REQUEST_TIMEOUT_MS;
}

function invalidMethodArgument(
  command: SpaceAPIMethod,
  parameter: string,
  expected: string,
  message: string,
): SpaceAPIProtocolError {
  return protocolError(message, SPACE_API_ERROR_CODES.invalidParams, { parameter, expected, command }, false);
}

function normalizeMethodArguments(command: SpaceAPIMethod, arguments_: unknown): SpaceAPIParameters {
  const definition = SPACE_API_METHOD_DEFINITIONS[command];
  if (!definition) {
    throw protocolError(
      `Unsupported SpaceAPI method '${command}'.`,
      SPACE_API_ERROR_CODES.methodNotFound,
      { command },
      false,
    );
  }
  if (!isRecord(arguments_)) {
    throw invalidMethodArgument(command, "params", "object", "SpaceAPI method parameters must be an object.");
  }

  const unknownParameter = Object.keys(arguments_)
    .sort()
    .find((parameter) => definition.parameters[parameter] === undefined);
  if (unknownParameter) {
    throw invalidMethodArgument(
      command,
      unknownParameter,
      "a supported parameter",
      `Parameter '${unknownParameter}' is not supported for ${command}.`,
    );
  }

  for (const parameter of definition.required) {
    const value = arguments_[parameter];
    if (value === undefined || (typeof value === "string" && value.length === 0)) {
      throw invalidMethodArgument(
        command,
        parameter,
        parameterKindDescription(definition.parameters[parameter] ?? "string"),
        `Missing required parameter '${parameter}'.`,
      );
    }
  }

  const normalized: SpaceAPIParameters = {};
  for (const [parameter, value] of Object.entries(arguments_)) {
    if (value === undefined) continue;
    const kind = definition.parameters[parameter];
    if (!kind) continue;

    switch (kind) {
      case "string":
        if (typeof value !== "string" || value.length === 0) {
          throw invalidMethodArgument(
            command,
            parameter,
            parameterKindDescription(kind),
            `Parameter '${parameter}' must be a non-empty string.`,
          );
        }
        normalized[parameter] = value;
        break;
      case "positiveInteger": {
        const numberValue = typeof value === "number" ? value : Number(value);
        if (!Number.isSafeInteger(numberValue) || numberValue <= 0) {
          throw invalidMethodArgument(
            command,
            parameter,
            parameterKindDescription(kind),
            `Parameter '${parameter}' must be a positive integer.`,
          );
        }
        normalized[parameter] = numberValue;
        break;
      }
      case "direction":
        if (typeof value !== "string" || !["up", "down"].includes(value.toLowerCase())) {
          throw invalidMethodArgument(
            command,
            parameter,
            parameterKindDescription(kind),
            `Parameter '${parameter}' must be either 'up' or 'down'.`,
          );
        }
        normalized[parameter] = value.toLowerCase();
        break;
      case "windowAction":
        if (typeof value !== "string" || !SPACE_API_WINDOW_ACTIONS.some((action) => action === value)) {
          throw invalidMethodArgument(
            command,
            parameter,
            parameterKindDescription(kind),
            `Parameter '${parameter}' is not a supported window action.`,
          );
        }
        normalized[parameter] = value;
        break;
    }
  }
  return normalized;
}

function parameterKindDescription(kind: SpaceAPIParameterKind): string {
  switch (kind) {
    case "string":
      return "a non-empty string";
    case "positiveInteger":
      return "a positive integer";
    case "direction":
      return "one of: up, down";
    case "windowAction":
      return `one of: ${SPACE_API_WINDOW_ACTIONS.join(", ")}`;
  }
}

function makeStructuredRequestPayload(
  requestID: string,
  command: SpaceAPIMethod,
  arguments_: SpaceAPIParameters,
): string {
  const request: {
    jsonrpc: string;
    id: string;
    method: SpaceAPIMethod;
    params?: SpaceAPIParameters;
  } = {
    jsonrpc: DESKTOP_RENAMER_JSON_RPC_VERSION,
    id: requestID,
    method: command,
  };
  if (Object.keys(arguments_).length > 0) request.params = arguments_;
  return JSON.stringify(request);
}

export async function runStructuredSpaceAPICommand<M extends SpaceAPIMethod>(
  command: M,
  arguments_: SpaceAPIMethodArguments[M] = {} as SpaceAPIMethodArguments[M],
): Promise<SpaceAPIMethodResults[M]> {
  const requestID = randomUUID();
  const parameters = normalizeMethodArguments(command, arguments_);
  const requestPayload = makeStructuredRequestPayload(requestID, command, parameters);
  if (Buffer.byteLength(requestPayload, "utf8") > structuredAPIMaxPayloadBytes) {
    throw protocolError(
      "Structured SpaceAPI request exceeds the maximum size.",
      SPACE_API_ERROR_CODES.payloadTooLarge,
      undefined,
      false,
    );
  }
  const script = makeStructuredSpaceAPIJXA(requestID, requestPayload, requestTimeout(command));

  try {
    const { stdout, stderr } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
      maxBuffer: 2 * 1024 * 1024,
    });
    const output = (stdout.trim() ? stdout : stderr).trimEnd();
    if (!output) throw new Error("DesktopRenamer returned an empty structured response.");
    const response = decodeStructuredRPCResponse(output, requestID);
    return validateStructuredResult(command, response.result) as SpaceAPIMethodResults[M];
  } catch (error) {
    if (error instanceof SpaceAPIProtocolError) {
      if (
        error.code === SPACE_API_ERROR_CODES.methodNotFound ||
        error.code === SPACE_API_ERROR_CODES.unsupportedContract
      ) {
        // The app may have restarted or changed capabilities since the
        // negotiation was cached. Force the next call to negotiate again.
        structuredAPIInfoLookup = null;
        structuredAPIMaxPayloadBytes = MAX_STRUCTURED_PAYLOAD_BYTES;
      }
      throw error;
    }
    throw protocolError(
      error instanceof Error ? error.message : "Structured SpaceAPI request failed.",
      undefined,
      undefined,
      true,
    );
  }
}

export async function runDesktopRenamerMethod<M extends SpaceAPIMethod>(
  command: M,
  arguments_: SpaceAPIMethodArguments[M] = {} as SpaceAPIMethodArguments[M],
  errorMessage = "Is DesktopRenamer running?",
): Promise<SpaceAPIMethodResults[M]> {
  let parameters: SpaceAPIParameters;
  try {
    parameters = normalizeMethodArguments(command, arguments_);
    await requireDesktopRenamerInstalled();
  } catch (error) {
    await handleDesktopRenamerError(error, errorMessage);
    throw error;
  }

  // API information is a structured capability record. The AppleScript
  // dictionary exposes the same record for Script Editor, but Raycast's
  // string-only AppleScript bridge cannot reliably decode native records.
  // Always use the correlated JSON-RPC form for this handshake.
  if (command === "getAPIInfo") {
    try {
      return (await getStructuredAPIInfo()) as SpaceAPIMethodResults[M];
    } catch (error) {
      await handleDesktopRenamerError(error, errorMessage);
      throw error;
    }
  }

  const method = communicationMethod();
  if (method === "applescript") {
    const result = await runDesktopRenamerScript(makeAppleScriptForMethod(command, parameters), errorMessage);
    try {
      return normalizeDesktopRenamerMethodResult(command, result);
    } catch (error) {
      await handleDesktopRenamerError(error, errorMessage);
      throw error;
    }
  }

  try {
    const result = await runSpaceAPIMethod(command, parameters, true);
    return normalizeDesktopRenamerMethodResult(command, result);
  } catch (error) {
    // A read can safely fall back to AppleScript. A write must stop after an
    // ambiguous API response so the same operation is never executed twice.
    if (
      method === "automatic" &&
      isReadSpaceAPIMethod(command) &&
      error instanceof SpaceAPIProtocolError &&
      error.canFallback
    ) {
      try {
        const result = await runAppleScript(makeAppleScriptForMethod(command, parameters));
        return normalizeDesktopRenamerMethodResult(command, result);
      } catch (scriptError) {
        await handleDesktopRenamerError(scriptError, errorMessage);
        throw scriptError;
      }
    }
    await handleDesktopRenamerError(error, errorMessage);
    throw error;
  }
}

function normalizeDesktopRenamerMethodResult<M extends SpaceAPIMethod>(
  command: M,
  result: unknown,
): SpaceAPIMethodResults[M] {
  if (result === "API Disabled") {
    throw new SpaceAPIProtocolError("SpaceAPI Disabled", SPACE_API_ERROR_CODES.apiDisabled, { command }, false);
  }
  switch (command) {
    case "getAPIInfo": {
      if (!isRecord(result)) {
        throw protocolError(
          "DesktopRenamer did not return structured API information.",
          SPACE_API_ERROR_CODES.unsupportedContract,
          undefined,
          false,
        );
      }
      return parseAPIInfo(result) as SpaceAPIMethodResults[M];
    }
    case "getAPIVersion":
      return requiredString(result, "result") as SpaceAPIMethodResults[M];
    case "getSpaceSnapshot":
      return (
        isRecord(result) ? parseSnapshot(result) : parseLegacySpaceSnapshotResult(requiredString(result, "result"))
      ) as SpaceAPIMethodResults[M];
    case "getCurrentSpaceName":
      return requiredString(result, "result") as SpaceAPIMethodResults[M];
    case "getCurrentSpaceID":
      return (
        Array.isArray(result)
          ? result.map((value) => requiredString(value, "result"))
          : requiredString(result, "result")
              .split(",")
              .map((spaceID) => spaceID.trim())
              .filter(Boolean)
      ) as SpaceAPIMethodResults[M];
    case "getAllSpaces":
      if (Array.isArray(result)) {
        return result.map(parseSpaceRecord) as SpaceAPIMethodResults[M];
      }
      if (isRecord(result) && Array.isArray(result.spaces)) {
        return result.spaces.map(parseSpaceRecord) as SpaceAPIMethodResults[M];
      }
      return parseLegacySpaceRecords(requiredString(result, "result")) as SpaceAPIMethodResults[M];
    case "getWindows":
      return (
        isRecord(result) ? parseWindowsSnapshot(result) : parseLegacyWindowsSnapshot(requiredString(result, "result"))
      ) as SpaceAPIMethodResults[M];
    case "toggleMenubar":
    case "toggleLauncher":
    case "toggleLabels":
    case "toggleActiveLabel":
    case "togglePreviewLabel":
    case "toggleDesktopVisibility":
      return booleanResult(result) as SpaceAPIMethodResults[M];
    default:
      return operationResult(result) as SpaceAPIMethodResults[M];
  }
}

export async function getSpaceSnapshot(errorMessage = "Failed to read spaces"): Promise<SpaceAPISnapshot> {
  return await runDesktopRenamerMethod("getSpaceSnapshot", {}, errorMessage);
}

export async function getAPIInfo(errorMessage = "Failed to read API information"): Promise<SpaceAPIInfo> {
  return await runDesktopRenamerMethod("getAPIInfo", {}, errorMessage);
}

export async function getWindowsSnapshot(errorMessage = "Failed to read windows"): Promise<SpaceAPIWindowsSnapshot> {
  return await runDesktopRenamerMethod("getWindows", {}, errorMessage);
}

export function mapWindowsSnapshot(snapshot: SpaceAPIWindowsSnapshot): {
  spaces: SpaceAPIWindowSpaceRecord[];
  windows: SpaceAPIWindowEntry[];
} {
  const spaces = snapshot.spaces.map((space) => ({
    id: space.id,
    name: space.name,
    displayID: space.displayID,
    num: space.number,
    isFullscreen: space.isFullscreen,
  }));
  const spacesByID = new Map(spaces.map((space) => [space.id, space]));
  const windows = snapshot.windows.flatMap((window) => {
    const space = spacesByID.get(window.spaceID);
    if (!space) return [];
    return [
      {
        windowID: window.id,
        pid: window.pid,
        ownerName: window.ownerName,
        appPath: window.appPath ?? "",
        title: window.title ?? "",
        isMinimized: window.isMinimized,
        isHidden: window.isHidden,
        space: { ...space },
      },
    ];
  });
  return { spaces, windows };
}

export async function getAllSpaces(errorMessage = "Failed to read spaces"): Promise<SpaceAPISpaceRecord[]> {
  return await runDesktopRenamerMethod("getAllSpaces", {}, errorMessage);
}

export async function getCurrentSpaceName(errorMessage = "Failed to read the current space"): Promise<string> {
  return await runDesktopRenamerMethod("getCurrentSpaceName", {}, errorMessage);
}

export async function getCurrentSpaceIDs(errorMessage = "Failed to read the current spaces"): Promise<string[]> {
  return await runDesktopRenamerMethod("getCurrentSpaceID", {}, errorMessage);
}

export async function switchToSpace(
  spaceID: string,
  errorMessage = "Failed to switch space",
): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("switchToSpace", { spaceID }, errorMessage);
}

export async function renameCurrentSpace(
  name: string,
  errorMessage = "Failed to rename space",
): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("renameCurrentSpace", { name }, errorMessage);
}

export async function renameSpace(
  spaceID: string,
  name: string,
  errorMessage = "Failed to rename space",
): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("renameSpace", { spaceID, name }, errorMessage);
}

export async function rearrangeSpace(
  spaceID: string,
  direction: "up" | "down",
  errorMessage = "Failed to rearrange space",
): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("rearrangeSpace", { spaceID, direction }, errorMessage);
}

export async function moveWindowNext(errorMessage = "Failed to move window"): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("moveWindowNext", {}, errorMessage);
}

export async function moveWindowPrevious(errorMessage = "Failed to move window"): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("moveWindowPrevious", {}, errorMessage);
}

export async function moveWindowToSpace(
  spaceID: string,
  errorMessage = "Failed to move window",
): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("moveWindowToSpace", { spaceID }, errorMessage);
}

export async function reloadSpaceLabels(
  errorMessage = "Failed to reload space labels",
): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("reloadSpaceLabels", {}, errorMessage);
}

export async function toggleMenubar(errorMessage = "Failed to toggle menubar"): Promise<boolean> {
  return await runDesktopRenamerMethod("toggleMenubar", {}, errorMessage);
}

export async function toggleLauncher(errorMessage = "Failed to toggle launcher"): Promise<boolean> {
  return await runDesktopRenamerMethod("toggleLauncher", {}, errorMessage);
}

export async function toggleLabels(errorMessage = "Failed to toggle labels"): Promise<boolean> {
  return await runDesktopRenamerMethod("toggleLabels", {}, errorMessage);
}

export async function toggleActiveLabel(errorMessage = "Failed to toggle active label"): Promise<boolean> {
  return await runDesktopRenamerMethod("toggleActiveLabel", {}, errorMessage);
}

export async function togglePreviewLabel(errorMessage = "Failed to toggle preview label"): Promise<boolean> {
  return await runDesktopRenamerMethod("togglePreviewLabel", {}, errorMessage);
}

export async function toggleDesktopVisibility(errorMessage = "Failed to toggle desktop visibility"): Promise<boolean> {
  return await runDesktopRenamerMethod("toggleDesktopVisibility", {}, errorMessage);
}

export async function focusWindow(
  windowID: number,
  pid: number,
  errorMessage = "Failed to focus window",
): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("focusWindow", { windowID, pid }, errorMessage);
}

export async function executeWindowAction(
  windowID: number,
  pid: number,
  action: SpaceAPIWindowAction,
  errorMessage = "Failed to execute window action",
): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("executeWindowAction", { windowID, pid, action }, errorMessage);
}

export async function moveSpecificWindow(
  args: { windowID: number; pid?: number; fromSpaceID: string; targetSpaceID: string },
  errorMessage = "Failed to move window",
): Promise<SpaceAPIOperationResult> {
  return await runDesktopRenamerMethod("moveSpecificWindow", args, errorMessage);
}

function operationResult(result: unknown): SpaceAPIOperationResult {
  if (isRecord(result) && typeof result.accepted === "boolean") {
    return { accepted: result.accepted };
  }
  if (typeof result === "boolean") return { accepted: result };
  if (result === "true" || result === "false") return { accepted: result === "true" };
  // AppleScript operations intentionally have no result value. Normalize that
  // compatibility behavior to the structured operation result for callers.
  if (result === "" || result === null || result === undefined) return { accepted: true };
  throw new Error("DesktopRenamer returned an invalid operation result.");
}

function booleanResult(result: unknown): boolean {
  if (typeof result === "boolean") return result;
  if (typeof result === "string" && (result === "true" || result === "false")) return result === "true";
  throw new Error("DesktopRenamer returned an invalid Boolean result.");
}

function makeAppleScriptForMethod(command: SpaceAPIMethod, arguments_: SpaceAPIParameters): string {
  const stringValue = (key: string): string => {
    const value = arguments_[key];
    if (typeof value !== "string" || value.length === 0) throw new Error(`Missing ${key}.`);
    return escapeAppleScriptString(value);
  };
  const integerValue = (key: string): string => {
    const value = arguments_[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${key}.`);
    return String(value);
  };

  switch (command) {
    case "getAPIInfo":
      return 'tell application "DesktopRenamer" to get api information';
    case "getAPIVersion":
      return 'tell application "DesktopRenamer" to get api version';
    case "getSpaceSnapshot":
      return `
        tell application "DesktopRenamer"
          set allSpaces to get all spaces
          set currentName to get current space name
          set currentId to get current space id
          return allSpaces & "~~~" & currentName & "~~~" & currentId
        end tell
      `;
    case "getCurrentSpaceName":
      return 'tell application "DesktopRenamer" to get current space name';
    case "getCurrentSpaceID":
      return 'tell application "DesktopRenamer" to get current space id';
    case "getAllSpaces":
      return 'tell application "DesktopRenamer" to get all spaces';
    case "getWindows":
      return 'tell application "DesktopRenamer" to get windows';
    case "switchToSpace":
      return `tell application "DesktopRenamer" to switch to space "${stringValue("spaceID")}"`;
    case "renameCurrentSpace":
      return `tell application "DesktopRenamer" to rename current space "${stringValue("name")}"`;
    case "renameSpace":
      return `tell application "DesktopRenamer" to rename space "${stringValue("spaceID")}" to "${stringValue("name")}"`;
    case "rearrangeSpace":
      return `tell application "DesktopRenamer" to rearrange space "${stringValue("spaceID")}" direction "${stringValue("direction")}"`;
    case "moveWindowNext":
      return 'tell application "DesktopRenamer" to move window next';
    case "moveWindowPrevious":
      return 'tell application "DesktopRenamer" to move window previous';
    case "moveWindowToSpace":
      return `tell application "DesktopRenamer" to move window to space "${stringValue("spaceID")}"`;
    case "reloadSpaceLabels":
      return 'tell application "DesktopRenamer" to reload space labels';
    case "toggleMenubar":
      return 'tell application "DesktopRenamer" to toggle menubar';
    case "toggleLauncher":
      return 'tell application "DesktopRenamer" to toggle launcher';
    case "toggleLabels":
      return 'tell application "DesktopRenamer" to toggle labels';
    case "toggleActiveLabel":
      return 'tell application "DesktopRenamer" to toggle active label';
    case "togglePreviewLabel":
      return 'tell application "DesktopRenamer" to toggle preview label';
    case "toggleDesktopVisibility":
      return 'tell application "DesktopRenamer" to toggle desktop visibility';
    case "focusWindow":
      return `tell application "DesktopRenamer" to focus window ${integerValue("windowID")} pid ${integerValue("pid")}`;
    case "executeWindowAction":
      return `tell application "DesktopRenamer" to execute window action "${integerValue("windowID")}" pid "${integerValue("pid")}" action "${stringValue("action")}"`;
    case "moveSpecificWindow": {
      const pid = arguments_.pid === undefined ? "" : ` pid "${integerValue("pid")}"`;
      return `tell application "DesktopRenamer" to move specific window "${integerValue("windowID")}"${pid} from space "${stringValue("fromSpaceID")}" to space "${stringValue("targetSpaceID")}"`;
    }
  }
}

function parseLegacySpaceSnapshotResult(raw: string): SpaceAPISnapshot {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const value = JSON.parse(trimmed) as unknown;
      const record = isRecord(value) ? value : undefined;
      if (!record || !Array.isArray(record.spaces)) throw new Error("Invalid legacy snapshot object.");
      const spaces = record.spaces.map(parseLegacySpaceObject);
      const currentSpaceIDs = Array.isArray(record.currentSpaceIDs)
        ? record.currentSpaceIDs.filter((spaceID): spaceID is string => typeof spaceID === "string")
        : typeof record.currentSpaceID === "string"
          ? record.currentSpaceID
              .split(",")
              .map((spaceID) => spaceID.trim())
              .filter(Boolean)
          : [];
      return {
        apiVersion: typeof record.apiVersion === "string" && record.apiVersion.length > 0 ? record.apiVersion : "0.0.0",
        revision: typeof record.revision === "number" && Number.isSafeInteger(record.revision) ? record.revision : 0,
        timestamp:
          typeof record.timestamp === "string" && record.timestamp.length > 0
            ? record.timestamp
            : new Date().toISOString(),
        currentSpaceIDs,
        currentSpaceName: typeof record.currentSpaceName === "string" ? record.currentSpaceName : "",
        spaces,
      };
    } catch {
      throw new Error("DesktopRenamer returned an invalid legacy space snapshot.");
    }
  }

  if (raw.split("~~~").length < 3) {
    throw new Error("DesktopRenamer returned an invalid legacy space snapshot.");
  }
  const parts = raw.split("~~~");
  const currentSpaceID = parts.pop()?.trim() ?? "";
  const currentSpaceName = parts.pop()?.trim() ?? "";
  const spaces = parseLegacySpaceRecords(parts.join("~~~"));
  return {
    apiVersion: "0.0.0",
    revision: 0,
    timestamp: new Date().toISOString(),
    currentSpaceIDs: currentSpaceID
      .split(",")
      .map((spaceID) => spaceID.trim())
      .filter(Boolean),
    currentSpaceName,
    spaces,
  };
}

function parseLegacySpaceObject(value: unknown): SpaceAPISpaceRecord {
  const record = isRecord(value) ? value : undefined;
  if (!record) throw new Error("Invalid legacy space record.");
  const id = typeof record.id === "string" ? record.id : "";
  if (!id) throw new Error("Legacy space record has no ID.");
  const displayID = typeof record.displayID === "string" ? record.displayID : "Display";
  const number = typeof record.number === "number" && Number.isSafeInteger(record.number) ? record.number : 0;
  return {
    id,
    name: typeof record.name === "string" && record.name.length > 0 ? record.name : "Unknown",
    displayID,
    displayName:
      typeof record.displayName === "string" && record.displayName.length > 0 ? record.displayName : displayID,
    number,
    isFullscreen: record.isFullscreen === true || record.isFullscreen === 1,
    appName: typeof record.appName === "string" ? record.appName : null,
    appPath: typeof record.appPath === "string" && record.appPath.length > 0 ? record.appPath : null,
    globalShortcutNumber:
      typeof record.globalShortcutNumber === "number" && Number.isSafeInteger(record.globalShortcutNumber)
        ? record.globalShortcutNumber
        : null,
  };
}

function parseLegacySpaceRecords(raw: string): SpaceAPISpaceRecord[] {
  return raw.split(/\r?\n/).flatMap((line) => {
    const normalizedLine = line.startsWith(">") ? line.slice(1) : line;
    if (!normalizedLine.trim()) return [];
    const parts = normalizedLine.split("~");
    if (parts.length < 4) return [];
    const id = parts[0]?.trim() ?? "";
    if (!id) return [];
    const numberText = parts[3]?.trim() ?? "";
    if (!numberText) return [];
    const number = Number(numberText);
    if (!Number.isSafeInteger(number) || number < 0) return [];
    const displayID = parts[2]?.trim() || "Display";
    return [
      {
        id,
        name: parts[1] || "Unknown",
        displayID,
        displayName: displayID,
        number,
        isFullscreen: parts.length >= 5 ? parts[4] === "1" : false,
        appName: null,
        appPath: parts[5] || null,
        globalShortcutNumber: null,
      },
    ];
  });
}

function parseLegacyWindowsSnapshot(raw: string): SpaceAPIWindowsSnapshot {
  const spaces: SpaceAPISpaceRecord[] = [];
  const windows: SpaceAPIWindowRecord[] = [];
  let currentSpace: SpaceAPISpaceRecord | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(">")) {
      const nextSpace = parseLegacySpaceRecords(line)[0];
      if (nextSpace) {
        currentSpace = nextSpace;
        spaces.push(nextSpace);
      }
      continue;
    }
    if (!line.startsWith("  ") || !currentSpace) continue;

    const parts = line.trim().split("|");
    if (parts.length < 5) continue;
    const id = Number(parts[0] ?? "");
    const pid = Number(parts[1] ?? "");
    if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(pid) || pid <= 0) continue;

    const hasStateFields = parts.length >= 7;
    const titleEnd = hasStateFields ? parts.length - 2 : parts.length;
    windows.push({
      id,
      pid,
      ownerName: parts[2] ?? "Unknown",
      appPath: parts[3] || null,
      title: parts.slice(4, titleEnd).join("|") || null,
      spaceID: currentSpace.id,
      isMinimized: hasStateFields ? parts[parts.length - 2] === "1" : false,
      isHidden: hasStateFields ? parts[parts.length - 1] === "1" : false,
    });
  }

  return {
    apiVersion: "0.0.0",
    revision: 0,
    timestamp: new Date().toISOString(),
    spaces,
    windows,
  };
}

async function runLegacySpaceAPICommand(command: string, arguments_: Record<string, string>): Promise<string> {
  const requestID = randomUUID();
  const timeoutMs = isReadSpaceAPIMethod(command) ? READ_REQUEST_TIMEOUT_MS : OPERATION_REQUEST_TIMEOUT_MS;
  const script = makeLegacySpaceAPIJXA(requestID, command, arguments_, timeoutMs);
  let stdout: string;
  let stderr: string;
  try {
    ({ stdout, stderr } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], {
      maxBuffer: 10 * 1024 * 1024,
    }));
  } catch (error) {
    throw protocolError(
      error instanceof Error ? error.message : "Legacy SpaceAPI request failed.",
      undefined,
      undefined,
      true,
    );
  }

  const output = (stdout.trim() ? stdout : stderr).trimEnd();
  let response: unknown;
  try {
    response = JSON.parse(output) as unknown;
  } catch {
    throw protocolError(
      "Legacy SpaceAPI returned an invalid response.",
      SPACE_API_ERROR_CODES.invalidRequest,
      undefined,
      true,
    );
  }
  if (!isRecord(response)) {
    throw protocolError(
      "Legacy SpaceAPI returned an invalid response.",
      SPACE_API_ERROR_CODES.invalidRequest,
      undefined,
      true,
    );
  }
  if (response.success === undefined) {
    throw protocolError(
      "Legacy SpaceAPI response has no success status.",
      SPACE_API_ERROR_CODES.invalidRequest,
      { command },
      true,
    );
  }
  const succeeded =
    response.success === true || response.success === "true" || response.success === 1 || response.success === "1";
  if (!succeeded) {
    const message =
      typeof response.error === "string" && response.error.length > 0
        ? response.error
        : "Legacy SpaceAPI command failed.";
    const code = message.includes("API Disabled")
      ? SPACE_API_ERROR_CODES.apiDisabled
      : SPACE_API_ERROR_CODES.operationFailed;
    throw protocolError(message, code, { command }, code !== SPACE_API_ERROR_CODES.apiDisabled);
  }
  if (response.apiVersion !== undefined && response.apiVersion !== null && typeof response.apiVersion !== "string") {
    throw protocolError(
      "Legacy SpaceAPI response has an invalid API version.",
      SPACE_API_ERROR_CODES.invalidRequest,
      undefined,
      true,
    );
  }
  if (response.result !== undefined && response.result !== null && typeof response.result !== "string") {
    throw protocolError(
      "Legacy SpaceAPI response has an invalid result.",
      SPACE_API_ERROR_CODES.invalidRequest,
      undefined,
      true,
    );
  }
  return typeof response.result === "string" ? response.result : "";
}

function makeStructuredSpaceAPIJXA(requestID: string, requestPayload: string, timeoutMs: number): string {
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
  pid?: number;
  fromSpaceID: string;
  targetSpaceID: string;
}): Promise<SpaceAPIOperationResult> {
  return await moveSpecificWindow(args);
}
