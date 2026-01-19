import { Detail, showToast, Toast } from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { useEffect, useState } from "react";

export default function Command() {
  const [currentSpaceName, setCurrentSpaceName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchSpaceName() {
      try {
        const result = await runAppleScript(`tell application "DesktopRenamer" to get current space name`);
        setCurrentSpaceName(result);
        setIsLoading(false);
      } catch (error) {
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to fetch space name",
          message: "Is DesktopRenamer running?",
        });
        setIsLoading(false);
      }
    }

    fetchSpaceName();
  }, []);

  return (
    <Detail
      isLoading={isLoading}
      markdown={`# Current Desktop\n\n**${currentSpaceName}**`}
    />
  );
}