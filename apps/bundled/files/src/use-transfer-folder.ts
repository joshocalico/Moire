/** "Show in folder" on a finished transfer: go to where it landed, if that receipt still shows. */
import { useRef } from "react";
import { operationError } from "@moire/file-operations";
import { transferDestinationFolder } from "./transfer-metadata";
import type { useFilesOperations } from "./use-operations";

export function useTransferFolder(
  ops: ReturnType<typeof useFilesOperations>,
  navigateTo: (directory: string) => void,
  notifyError: (message: string) => void,
): (() => void) | undefined {
  const transfer = ops.transferDisplay;
  // The folder resolves later; act only if the same receipt is still showing.
  const shown = useRef(transfer);
  shown.current = transfer;
  if (!transfer || transfer.outcome === "running" || !transfer.progress.validatedDirectory)
    return undefined;
  const receipt = transfer;
  const directory = transfer.progress.validatedDirectory;
  return () => {
    void transferDestinationFolder(directory).then(
      (folder) => {
        if (shown.current !== receipt) return;
        navigateTo(folder);
        ops.setTransferDisplay(null);
      },
      (error) => {
        if (shown.current !== receipt) return;
        const message = `Could not show the transfer destination. ${operationError(error)}`;
        notifyError(message);
        ops.setTransferDisplay({ ...receipt, navigationError: message });
      },
    );
  };
}
