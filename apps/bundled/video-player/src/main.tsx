import React, { type ReactNode } from "react";
import { type WindowActions, type WindowSize } from "@moire/ui";
import { PlayerApp, runApp, startMain } from "@moire/app-tools";
export function VideoPlayerApp(
  props: WindowSize & {
    initialPath?: string;
    initialPaths?: string[];
    window?: WindowActions | null;
  },
): ReactNode {
  return (
    <PlayerApp
      {...props}
      video
      initialPaths={props.initialPaths ?? (props.initialPath ? [props.initialPath] : [])}
    />
  );
}
startMain(import.meta.url, () =>
  runApp("Video Player", "org.moire.VideoPlayer", (size, window) => (
    <VideoPlayerApp
      {...size}
      window={window}
      initialPaths={process.argv.slice(2).filter((value) => !value.startsWith("-"))}
    />
  )),
);
