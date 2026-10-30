/** The Open With picker, for the AppChooser portal and for Moire's own activation interface. */
import React, { useState, type ReactNode } from "react";
import type { OpenWithModel } from "@moire/app-discovery";
import { OpenWithPicker, type WindowSize } from "@moire/ui";
import {
  RESPONSE_CANCELLED,
  RESPONSE_OTHER,
  RESPONSE_SUCCESS,
  type PortalResponse,
} from "./common";
import type { DialogSlot } from "./dialog";

export type ChoiceResult = {
  response: PortalResponse;
  choice?: string;
  makeDefault?: boolean;
};

type ModelForIds = (ids: string[], selectedId: string | null) => OpenWithModel;

function Chooser(
  props: WindowSize & {
    initialModel: OpenWithModel;
    registerUpdater: (update: (ids: string[]) => void) => void;
    modelForIds: ModelForIds;
    allowMakeDefault: boolean;
    onDrag: () => void;
    finish: (result: ChoiceResult) => void;
  },
): ReactNode {
  const [model, setModel] = useState(props.initialModel);
  const [selectedId, setSelectedId] = useState(model.selectedId);
  props.registerUpdater((ids) => {
    setModel((current) => {
      const next = props.modelForIds(ids, selectedId ?? current.selectedId);
      setSelectedId(next.selectedId);
      return next;
    });
  });
  return (
    <OpenWithPicker
      viewportWidth={props.width}
      viewportHeight={props.height}
      fileName={model.fileName}
      mimeType={model.mimeType}
      choices={model.choices}
      selectedId={selectedId}
      onSelect={setSelectedId}
      onOpen={(choice) => props.finish({ response: RESPONSE_SUCCESS, choice })}
      onMakeDefault={(choice) =>
        props.finish({ response: RESPONSE_SUCCESS, choice, makeDefault: true })
      }
      allowMakeDefault={props.allowMakeDefault}
      standalone
      onDrag={props.onDrag}
      onDismiss={() => props.finish({ response: RESPONSE_CANCELLED })}
    />
  );
}

export function presentChooser(
  dialogs: DialogSlot,
  handle: string,
  initialModel: OpenWithModel,
  modelForIds: ModelForIds,
  allowMakeDefault = true,
): Promise<ChoiceResult> {
  let update: ((ids: string[]) => void) | null = null;
  let queuedChoices: string[] | null = null;
  return dialogs.present<ChoiceResult>(
    handle,
    {
      title: `Open ${initialModel.fileName} With`,
      width: 680,
      height: 520,
      dismissed: { response: RESPONSE_CANCELLED },
      render: (size, finish, window) => (
        <Chooser
          {...size}
          initialModel={initialModel}
          registerUpdater={(next) => {
            update = next;
            if (queuedChoices) {
              const ids = queuedChoices;
              queuedChoices = null;
              queueMicrotask(() => {
                update?.(ids);
                window.requestRedraw();
              });
            }
          }}
          modelForIds={modelForIds}
          allowMakeDefault={allowMakeDefault}
          onDrag={() => window.beginMove()}
          finish={finish}
        />
      ),
    },
    { response: RESPONSE_OTHER },
    (window) => ({
      replaceChoices: (ids) => {
        if (update) {
          update(ids);
          window.requestRedraw();
        } else queuedChoices = ids;
      },
    }),
  );
}
