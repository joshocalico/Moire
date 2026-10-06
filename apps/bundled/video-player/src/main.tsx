import React, { type ReactNode } from "react";
import { type WindowSize } from "@moire/ui";
import { PlayerApp, runApp, startMain } from "@moire/app-tools";
export function VideoPlayerApp(
  props: WindowSize & { initialPath?: string; initialPaths?: string[] },
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
  runApp("Video Player", "org.moire.VideoPlayer", (size) => (
    <VideoPlayerApp
      {...size}
      initialPaths={process.argv.slice(2).filter((value) => !value.startsWith("-"))}
    />
  )),
);
