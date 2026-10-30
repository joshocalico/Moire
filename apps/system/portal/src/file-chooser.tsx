/** Moire's file chooser as a portal dialog. */
import React from "react";
import { FileChooser } from "@moire/app-tools";
import {
  RESPONSE_CANCELLED,
  RESPONSE_OTHER,
  RESPONSE_SUCCESS,
  type PortalResponse,
} from "./common";
import type { DialogSlot } from "./dialog";
import type { ChooserRequest } from "./file-chooser-model";

export type FileChoice = { response: PortalResponse; paths: string[] };

export function presentFileChooser(
  dialogs: DialogSlot,
  handle: string,
  request: ChooserRequest,
): Promise<FileChoice> {
  return dialogs.present<FileChoice>(
    handle,
    {
      title: request.title,
      width: 880,
      height: 620,
      dismissed: { response: RESPONSE_CANCELLED, paths: [] },
      render: (size, finish) => (
        <FileChooser
          {...size}
          mode={request.mode}
          appId={request.chooserId}
          title={request.title}
          accept={request.accept}
          directory={request.directory}
          name={request.name}
          multiple={request.multiple}
          onChoose={(file) => finish({ response: RESPONSE_SUCCESS, paths: [file] })}
          onChooseMany={(files) => finish({ response: RESPONSE_SUCCESS, paths: files })}
          onCancel={() => finish({ response: RESPONSE_CANCELLED, paths: [] })}
        />
      ),
    },
    { response: RESPONSE_OTHER, paths: [] },
  );
}
