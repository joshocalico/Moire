import React, { useState, type ReactNode } from "react";
import { spawn } from "node:child_process";
import { FileActivationService, type OpenWithModel } from "@moire/app-discovery";
import { SessionBus, variant, type DbusVariant } from "@moire/dbus";
import { Application, OpenWithPicker, Window, type WindowSize } from "@moire/ui";

const PORTAL_NAME = "org.freedesktop.impl.portal.desktop.moire";
const PORTAL_PATH = "/org/freedesktop/portal/desktop";
const APP_CHOOSER = "org.freedesktop.impl.portal.AppChooser";
const FILE_ACTIVATION = "org.moire.FileActivation1";
const REQUEST = "org.freedesktop.impl.portal.Request";

type PortalOptions = Record<string, DbusVariant>;

type ChoiceResult = {
  response: 0 | 1 | 2;
  choice?: string;
  makeDefault?: boolean;
};

type ActiveChoice = {
  handle: string;
  replaceChoices: (ids: string[]) => void;
  cancel: () => void;
};

function option<T>(options: PortalOptions, key: string, fallback: T): T {
  return (options[key]?.value as T | undefined) ?? fallback;
}

function Chooser(
  props: WindowSize & {
    initialModel: OpenWithModel;
    registerUpdater: (update: (ids: string[]) => void) => void;
    modelForIds: (ids: string[], selectedId: string | null) => OpenWithModel;
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
      onOpen={(choice) => props.finish({ response: 0, choice })}
      onMakeDefault={(choice) => props.finish({ response: 0, choice, makeDefault: true })}
      allowMakeDefault={props.allowMakeDefault}
      standalone
      onDrag={props.onDrag}
      onDismiss={() => props.finish({ response: 1 })}
    />
  );
}

async function presentChooser(
  initialModel: OpenWithModel,
  modelForIds: (ids: string[], selectedId: string | null) => OpenWithModel,
  activate: (active: Omit<ActiveChoice, "handle">) => void,
  allowMakeDefault = true,
): Promise<ChoiceResult> {
  const app = new Application();
  const win = new Window({
    title: `Open ${initialModel.fileName} With`,
    appId: "org.moire.Portal",
    width: 680,
    height: 520,
    resizable: true,
    decorated: false,
  });
  let settled = false;
  let update: ((ids: string[]) => void) | null = null;
  let queuedChoices: string[] | null = null;
  let resolveResult: (result: ChoiceResult) => void = () => {};
  const result = new Promise<ChoiceResult>((resolve) => {
    resolveResult = resolve;
  });
  const finish = (choice: ChoiceResult) => {
    if (settled) return;
    settled = true;
    resolveResult(choice);
    win.destroy();
    app.quit();
  };
  win.setContent((size) => (
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
            win.requestRedraw();
          });
        }
      }}
      modelForIds={modelForIds}
      allowMakeDefault={allowMakeDefault}
      onDrag={() => win.beginMove()}
      finish={finish}
    />
  ));
  win.onClose(() => finish({ response: 1 }));
  app.addWindow(win);
  activate({
    replaceChoices: (ids) => {
      if (update) {
        update(ids);
        win.requestRedraw();
      } else {
        queuedChoices = ids;
      }
    },
    cancel: () => finish({ response: 2 }),
  });
  await app.run();
  return result;
}

async function main(): Promise<void> {
  const bus = await SessionBus.connect();
  const activation = new FileActivationService(({ command }) => {
    spawn("/bin/sh", ["-lc", command], {
      detached: true,
      stdio: "ignore",
    }).unref();
  });
  let active: ActiveChoice | null = null;

  bus.exportObject(PORTAL_PATH, {
    name: APP_CHOOSER,
    methods: {
      ChooseApplication: {
        inSignature: "ossasa{sv}",
        outSignature: "ua{sv}",
        handler: async ({ body }) => {
          const [handle, _appId, _parentWindow, ids, rawOptions] = body as [
            string,
            string,
            string,
            string[],
            PortalOptions,
          ];
          if (active) return { body: [2, {}] };
          const options = rawOptions ?? {};
          const mimeType = option(options, "content_type", "application/octet-stream");
          const fileName = option(options, "filename", "File");
          const lastChoice = option<string | null>(options, "last_choice", null);
          const makeModel = (applicationIds: string[], selectedId: string | null) =>
            activation.applicationChoiceModel({
              fileName,
              mimeType,
              applicationIds,
              selectedId,
            });
          const removeRequest = bus.exportObject(handle, {
            name: REQUEST,
            methods: {
              Close: {
                inSignature: "",
                outSignature: "",
                handler: () => {
                  active?.cancel();
                  return {};
                },
              },
            },
          });
          try {
            const result = await presentChooser(
              makeModel(ids, lastChoice),
              makeModel,
              (request) => {
                active = { handle, ...request };
              },
            );
            const results: Record<string, DbusVariant> = {};
            if (result.choice) {
              if (result.makeDefault) {
                activation.setDefaultApplication(mimeType, result.choice);
              }
              results.choice = variant("s", result.choice);
            }
            const token = option(options, "activation_token", "");
            if (token) results.activation_token = variant("s", token);
            return { body: [result.response, results] };
          } finally {
            removeRequest();
            active = null;
          }
        },
      },
      UpdateChoices: {
        inSignature: "oas",
        outSignature: "",
        handler: ({ body }) => {
          const [handle, ids] = body as [string, string[]];
          if (active?.handle === handle) active.replaceChoices(ids);
          return {};
        },
      },
    },
  });

  bus.exportObject(PORTAL_PATH, {
    name: FILE_ACTIVATION,
    methods: {
      OpenWith: {
        inSignature: "so",
        outSignature: "u",
        handler: async ({ body }) => {
          const [filePath, handle] = body as [string, string];
          if (active) return { body: [2] };
          const initialModel = activation.openWithModel(filePath);
          const modelForIds = (applicationIds: string[], selectedId: string | null) =>
            activation.applicationChoiceModel({
              fileName: initialModel.fileName,
              mimeType: initialModel.mimeType,
              applicationIds,
              selectedId,
            });
          const removeRequest = bus.exportObject(handle, {
            name: REQUEST,
            methods: {
              Close: {
                inSignature: "",
                outSignature: "",
                handler: () => {
                  active?.cancel();
                  return {};
                },
              },
            },
          });
          try {
            const result = await presentChooser(initialModel, modelForIds, (request) => {
              active = { handle, ...request };
            });
            if (result.response === 0 && result.choice) {
              if (result.makeDefault) {
                activation.setDefaultApplication(initialModel.mimeType, result.choice);
              }
              activation.openWith(filePath, result.choice);
            }
            return { body: [result.response] };
          } finally {
            removeRequest();
            active = null;
          }
        },
      },
    },
  });

  // Export before claiming the well-known name: D-Bus activation forwards the
  // queued first call as soon as RequestName succeeds.
  const ownership = await bus.requestName(PORTAL_NAME);
  if (ownership !== 1 && ownership !== 4) {
    throw new Error(`${PORTAL_NAME} is already owned (result ${ownership})`);
  }

  console.log(`[portal] ready: ${PORTAL_NAME}`);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("[portal]", error);
  process.exit(1);
});
