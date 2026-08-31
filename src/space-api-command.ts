import { runAppleScript } from "@raycast/utils";
import { SpaceAPIProtocolError } from "./space-api-types";
import { isReadSpaceAPIMethod } from "./space-api-codec";
import { runLegacySpaceAPICommand } from "./space-api-legacy";
import { parseSpaceAPICommand } from "./space-api-script";
import { handleDesktopRenamerError, communicationMethod, requireDesktopRenamerInstalled } from "./space-api-runtime";
import { normalizeMethodArguments, runDesktopRenamerScript, stringifyLegacyParameters } from "./space-api-transport";

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
