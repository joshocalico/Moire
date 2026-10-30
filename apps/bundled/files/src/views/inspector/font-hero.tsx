/**
 * A font's specimen and, when its family has other faces beside it or installed, a picker
 * that draws the specimen in each (Regular / Medium / Bold…).
 */
import React, { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  ImageWidget,
  SegmentedControl,
  Surface,
  getUiScaleFactor,
  usePalette,
  type FontSampleLine,
} from "@moire/ui";
import type { Entry } from "#files/filesystem";
import { fontFamilyFaces, type FontFace } from "#files/preview/font-family";
import { useFontSample } from "#files/preview/use-font-sample";
import { Thumbnail } from "#files/views/thumbnail";
import { px } from "./cards";

const SPECIMEN_HEIGHT = 162;
const PICKER = 30;
const PICKER_GAP = 14;
/** Faces shown in the picker; a family of nine weights would not fit the pane. */
const MAX_FACES = 4;

const SPECIMEN: readonly FontSampleLine[] = [
  { text: "Aa Bb Cc Gg Qq", size: 40 },
  { text: "The quick brown fox jumps over the lazy dog", size: 15 },
  { text: "Sphinx of black quartz, judge my vow.", size: 15 },
  { text: "0123456789 & ! ? @ ( ) — “ ”", size: 15 },
];

export const fontHeroHeight = () => px(SPECIMEN_HEIGHT + PICKER_GAP + PICKER);

/** The faces of `file`'s family, read off the render path; the file alone until then. */
function useFaces(file: string): FontFace[] | null {
  const [state, setState] = useState<{ file: string; faces: FontFace[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fontFamilyFaces(file, controller.signal).then(
      (faces) => !controller.signal.aborted && setState({ file, faces }),
      () => {
        // Cancelled, or unreadable: the picker stays hidden.
      },
    );
    return () => controller.abort();
  }, [file]);
  return state?.file === file ? state.faces : null;
}

/** The faces worth offering: one per weight, the file's own always among them. */
function pickFaces(faces: readonly FontFace[], file: string): FontFace[] {
  const own = faces.find((face) => face.path === file);
  const upright = faces.filter((face) => !/italic|oblique/i.test(face.style) || face.path === file);
  const byWeight = new Map<number, FontFace>();
  for (const face of upright)
    if (!byWeight.has(face.weight) || face.path === file) byWeight.set(face.weight, face);
  const ordered = [...byWeight.values()].sort((a, b) => a.weight - b.weight);
  // Prefer the common weights when there are many.
  const preferred = [400, 500, 700, 300];
  const chosen =
    ordered.length <= MAX_FACES
      ? ordered
      : preferred
          .map((weight) => ordered.find((face) => face.weight === weight))
          .filter((face): face is FontFace => !!face)
          .slice(0, MAX_FACES);
  if (own && !chosen.includes(own)) chosen.splice(chosen.length - 1, 1, own);
  return chosen.sort((a, b) => a.weight - b.weight);
}

export function FontHero(props: { entry: Entry; width: number; height: number }): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const faces = useFaces(props.entry.path);
  const [chosen, setChosen] = useState<{ file: string; face: string } | null>(null);
  const options = faces ? pickFaces(faces, props.entry.path) : [];
  const face =
    chosen?.file === props.entry.path && options.some((option) => option.path === chosen.face)
      ? chosen.face
      : props.entry.path;
  const specimen = px(SPECIMEN_HEIGHT);
  const inner = props.width - px(32);
  const lines = SPECIMEN.map((line) => ({ ...line, size: Math.round(line.size * ui) }));
  const sample = useFontSample(face, lines, pal.text, inner);
  return (
    <Box width={props.width} height={props.height}>
      <Surface
        width={props.width}
        height={specimen}
        fill={pal.bg}
        radius={px(10)}
        stroke={pal.borderSubtle}
        strokeWidth={1}
        clip
      >
        {sample ? (
          <ImageWidget
            x={px(16)}
            y={px(16)}
            width={Math.min(inner, sample.width)}
            height={Math.min(specimen - px(32), sample.height)}
            bitmap={sample}
            fit="contain"
            placeholder={false}
          />
        ) : (
          <Thumbnail
            entry={props.entry}
            width={props.width}
            height={specimen}
            radius={px(10)}
            backdrop={pal.bg}
            fit="contain"
          />
        )}
      </Surface>
      {options.length ? (
        <SegmentedControl
          y={specimen + px(PICKER_GAP) - px(4)}
          width={props.width}
          height={px(PICKER)}
          size="small"
          options={options.map((option) => ({ id: option.path, label: option.style }))}
          value={face}
          onChange={(next) => setChosen({ file: props.entry.path, face: next })}
        />
      ) : null}
    </Box>
  );
}
