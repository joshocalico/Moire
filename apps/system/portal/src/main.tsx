/**
 * Moire's xdg-desktop-portal backend (docs/portals.md): AppChooser, Settings, Notification,
 * Inhibit and FileChooser for the frontend, and org.moire.FileActivation1 for Moire's own apps.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { FileActivationService, type OpenWithModel } from "@moire/app-discovery";
import {
  DbusRemoteError,
  SessionBus,
  variant,
  type DbusMethodContext,
  type DbusVariant,
} from "@moire/dbus";
import { presentChooser, type ChoiceResult } from "./app-chooser";
import {
  PORTAL_NAME,
  PORTAL_PATH,
  RESPONSE_OTHER,
  RESPONSE_SUCCESS,
  exportRequest,
  frontendGuard,
  guarded,
  option,
  plainText,
  type PortalOptions,
  type PortalResponse,
} from "./common";
import { DialogSlot } from "./dialog";
import { presentFileChooser } from "./file-chooser";
import { chooserRequest, chooserResults, type ChooserKind } from "./file-chooser-model";
import { INHIBIT, attachInhibit } from "./inhibit";
import { NOTIFICATION, attachNotification } from "./notification";
import { openTargetForFd, openTargetForUri, type OpenTarget } from "./open-uri";
import { SETTINGS, attachSettings } from "./settings";

const APP_CHOOSER = "org.freedesktop.impl.portal.AppChooser";
const FILE_CHOOSER = "org.freedesktop.impl.portal.FileChooser";
const FILE_ACTIVATION = "org.moire.FileActivation1";
const PROPERTIES = "org.freedesktop.DBus.Properties";

/** The `version` property of each backend interface, read by the frontend. */
const VERSIONS: Record<string, number> = {
  [APP_CHOOSER]: 2,
  [FILE_CHOOSER]: 3,
  [SETTINGS]: 1,
  [NOTIFICATION]: 1,
  [INHIBIT]: 3,
};

/** Descriptors (OpenFile) need the native transport, which exists on Linux only. */
async function connect(): Promise<SessionBus> {
  if (process.platform === "linux") {
    try {
      const { dbusUnixFdTransport } = await import("@moire/sys/dbus-fds");
      return await SessionBus.connect(undefined, { unixFds: dbusUnixFdTransport });
    } catch (error) {
      console.warn("[portal] descriptor passing unavailable:", error);
    }
  }
  return SessionBus.connect();
}

async function main(): Promise<void> {
  const bus = await connect();
  const activation = new FileActivationService(({ command }) => {
    spawn("/bin/sh", ["-lc", command], {
      detached: true,
      stdio: "ignore",
    }).unref();
  });
  const extensionsForMime = (mime: string) => activation.mimeDatabase.extensionsForMime(mime);
  const dialogs = new DialogSlot();
  const guard = await frontendGuard(bus);

  /** Show the Open With picker for one request, with its Request object exported meanwhile. */
  const choose = async (
    context: DbusMethodContext,
    handle: unknown,
    model: OpenWithModel,
    modelForIds: (ids: string[], selectedId: string | null) => OpenWithModel,
    allowMakeDefault = true,
  ): Promise<ChoiceResult> => {
    if (dialogs.busy) return { response: RESPONSE_OTHER };
    const removeRequest = exportRequest(bus, context, handle, () => {
      const active = dialogs.active;
      if (active && active.handle === handle) active.cancel();
    });
    try {
      return await presentChooser(dialogs, String(handle), model, modelForIds, allowMakeDefault);
    } finally {
      removeRequest();
    }
  };

  bus.exportObject(
    PORTAL_PATH,
    guarded(guard, {
      name: APP_CHOOSER,
      methods: {
        ChooseApplication: {
          inSignature: "ossasa{sv}",
          outSignature: "ua{sv}",
          handler: async (context) => {
            const [handle, _appId, _parentWindow, ids, rawOptions] = context.body as [
              string,
              string,
              string,
              string[],
              PortalOptions,
            ];
            const options = rawOptions ?? {};
            const mimeType = option(options, "content_type", "s", "application/octet-stream");
            const fileName =
              option(options, "filename", "s", "") || option(options, "uri", "s", "File");
            const lastChoice = option<string | null>(options, "last_choice", "s", null);
            const makeModel = (applicationIds: string[], selectedId: string | null) =>
              activation.applicationChoiceModel({
                fileName,
                mimeType,
                applicationIds,
                selectedId,
              });
            const result = await choose(context, handle, makeModel(ids, lastChoice), makeModel);
            const results: Record<string, DbusVariant> = {};
            if (result.choice) {
              if (result.makeDefault) activation.setDefaultApplication(mimeType, result.choice);
              results.choice = variant("s", result.choice);
            }
            const token = option(options, "activation_token", "s", "");
            if (token) results.activation_token = variant("s", token);
            return { body: [result.response, results] };
          },
        },
        UpdateChoices: {
          inSignature: "oas",
          outSignature: "",
          handler: ({ body }) => {
            const [handle, ids] = body as [string, string[]];
            if (dialogs.active?.handle === handle) dialogs.active.replaceChoices?.(ids);
            return {};
          },
        },
      },
    }),
  );

  const fileChooser = (kind: ChooserKind) => ({
    inSignature: "osssa{sv}",
    outSignature: "ua{sv}",
    handler: async (context: DbusMethodContext) => {
      const [handle, appId, , title, options] = context.body as [
        string,
        string,
        string,
        string,
        PortalOptions,
      ];
      if (dialogs.busy) return { body: [RESPONSE_OTHER, {}] };
      const request = chooserRequest(kind, appId, title, options ?? {}, extensionsForMime);
      const removeRequest = exportRequest(bus, context, handle, () => {
        const active = dialogs.active;
        if (active && active.handle === handle) active.cancel();
      });
      try {
        const choice = await presentFileChooser(dialogs, handle, request);
        return {
          body: [
            choice.response,
            choice.response === RESPONSE_SUCCESS
              ? chooserResults(request, choice.paths, extensionsForMime)
              : {},
          ],
        };
      } finally {
        removeRequest();
      }
    },
  });
  bus.exportObject(
    PORTAL_PATH,
    guarded(guard, {
      name: FILE_CHOOSER,
      methods: {
        OpenFile: fileChooser("open"),
        SaveFile: fileChooser("save"),
        SaveFiles: fileChooser("save-files"),
      },
    }),
  );

  /** Open a checked target with its default application, or with one the person picks. */
  const open = async (
    context: DbusMethodContext,
    handle: unknown,
    target: OpenTarget,
    options: PortalOptions,
  ): Promise<PortalResponse> => {
    if (target.kind === "refused")
      throw new DbusRemoteError("org.freedesktop.portal.Error.NotAllowed", target.reason);
    if (target.kind === "directory")
      return activation.openDefault(target.path) ? RESPONSE_SUCCESS : RESPONSE_OTHER;
    activation.refreshAssociations();
    const mustAsk = target.kind === "file" && target.ask;
    const ask = mustAsk || option(options, "ask", "b", false);
    if (!ask && activation.mimeDatabase.defaultApplicationForMime(target.mimeType)) {
      const opened =
        target.kind === "file"
          ? activation.openDefault(target.path)
          : activation.openUri(target.uri);
      return opened ? RESPONSE_SUCCESS : RESPONSE_OTHER;
    }
    const model =
      target.kind === "file"
        ? activation.openWithModel(target.path)
        : activation.applicationChoiceModel({
            fileName: target.uri.slice(0, 120),
            mimeType: target.mimeType,
            applicationIds: [],
          });
    if (model.choices.length === 0) return RESPONSE_OTHER;
    const modelForIds = (applicationIds: string[], selectedId: string | null) =>
      activation.applicationChoiceModel({
        fileName: model.fileName,
        mimeType: model.mimeType,
        applicationIds,
        selectedId,
      });
    // A script never gains a default handler through this path.
    const result = await choose(context, handle, model, modelForIds, !mustAsk);
    if (result.response !== RESPONSE_SUCCESS || !result.choice) return result.response;
    if (result.makeDefault && !mustAsk)
      activation.setDefaultApplication(target.mimeType, result.choice);
    const opened =
      target.kind === "file"
        ? activation.openWith(target.path, result.choice)
        : activation.openUri(target.uri, result.choice);
    return opened ? RESPONSE_SUCCESS : RESPONSE_OTHER;
  };
  const descriptor = (context: DbusMethodContext): number => {
    const fd = context.fds[Number(context.body[2])];
    if (fd === undefined)
      throw new DbusRemoteError(
        "org.freedesktop.DBus.Error.NotSupported",
        "This session bus connection cannot pass file descriptors",
      );
    return fd;
  };

  // Moire's own apps: any process of this session may call; nothing here trusts a claimed app id.
  bus.exportObject(PORTAL_PATH, {
    name: FILE_ACTIVATION,
    methods: {
      OpenWith: {
        inSignature: "so",
        outSignature: "u",
        handler: async (context) => {
          const [filePath, handle] = context.body as [string, string];
          const initialModel = activation.openWithModel(filePath);
          const modelForIds = (applicationIds: string[], selectedId: string | null) =>
            activation.applicationChoiceModel({
              fileName: initialModel.fileName,
              mimeType: initialModel.mimeType,
              applicationIds,
              selectedId,
            });
          const result = await choose(context, handle, initialModel, modelForIds);
          if (result.response === RESPONSE_SUCCESS && result.choice) {
            if (result.makeDefault)
              activation.setDefaultApplication(initialModel.mimeType, result.choice);
            activation.openWith(filePath, result.choice);
          }
          return { body: [result.response] };
        },
      },
      OpenURI: {
        inSignature: "ossa{sv}",
        outSignature: "u",
        handler: async (context) => {
          const [handle, , uri, options] = context.body as [string, string, string, PortalOptions];
          return {
            body: [await open(context, handle, openTargetForUri(activation, uri), options ?? {})],
          };
        },
      },
      OpenFile: {
        inSignature: "osha{sv}",
        outSignature: "u",
        handler: async (context) => {
          const target = openTargetForFd(activation, descriptor(context));
          const options = (context.body[3] ?? {}) as PortalOptions;
          return { body: [await open(context, context.body[0], target, options)] };
        },
      },
      OpenDirectory: {
        inSignature: "osha{sv}",
        outSignature: "u",
        handler: (context) => {
          const target = openTargetForFd(activation, descriptor(context));
          // Show the folder that holds the file; the file itself is not opened.
          const folder =
            target.kind === "directory"
              ? target.path
              : target.kind === "file"
                ? path.dirname(target.path)
                : null;
          if (!folder)
            throw new DbusRemoteError(
              "org.freedesktop.portal.Error.NotAllowed",
              target.kind === "refused" ? target.reason : "Not a file",
            );
          return { body: [activation.openDefault(folder) ? RESPONSE_SUCCESS : RESPONSE_OTHER] };
        },
      },
    },
  });

  attachSettings(bus, guard);
  // A service that is not running yet must not keep the others from starting.
  await attachNotification(bus, guard, {
    appName: (appId) => activation.applicationName(appId),
  }).catch((error: unknown) => console.warn("[portal] notifications unavailable:", error));
  await attachInhibit(bus, guard).catch((error: unknown) =>
    console.warn("[portal] inhibit unavailable:", error),
  );

  bus.exportObject(PORTAL_PATH, {
    name: PROPERTIES,
    methods: {
      Get: {
        inSignature: "ss",
        outSignature: "v",
        handler: ({ body }) => {
          const version = VERSIONS[String(body[0])];
          if (version !== undefined && body[1] === "version")
            return { body: [variant("u", version)] };
          if (body[0] === NOTIFICATION && body[1] === "SupportedOptions")
            return { body: [variant("a{sv}", {})] };
          throw new DbusRemoteError(
            "org.freedesktop.DBus.Error.UnknownProperty",
            `No property ${plainText(body[1], 64)}`,
          );
        },
      },
      GetAll: {
        inSignature: "s",
        outSignature: "a{sv}",
        handler: ({ body }) => {
          const version = VERSIONS[String(body[0])];
          return {
            body: [
              version === undefined
                ? {}
                : {
                    version: variant("u", version),
                    ...(body[0] === NOTIFICATION ? { SupportedOptions: variant("a{sv}", {}) } : {}),
                  },
            ],
          };
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

  // The session bus going away is the session ending.
  bus.onDisconnect(() => process.exit(0));
  console.log(`[portal] ready: ${PORTAL_NAME}`);
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("[portal]", error);
  process.exit(1);
});
