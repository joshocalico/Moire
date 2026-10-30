import React, { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Horizontal,
  ImageWidget,
  TextArea,
  TextBlock,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { ToolButton, ToolReadout, errorText, type Preview } from "@moire/app-tools";
import { fontPreview } from "#font-viewer/backend";
import type { Face } from "#font-viewer/model";

/** Free sample text set in the face at a chosen size, paged when it overflows. */
export function TypeTester(props: {
  file: string;
  width: number;
  height: number;
  sample: string;
  onSample: (sample: string) => void;
  rendered: { sample: string; size: number; page: number };
  onPage: (page: number) => void;
  pageCount: number;
  onPageCount: (count: number) => void;
  onFace: (face: Face) => void;
  onError: (message: string) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState("");
  const pad = 12 * ui;
  const sampleH = 94 * ui;
  const pagerY = pad + sampleH + 8 * ui;
  const previewY = pagerY + 32 * ui + 8 * ui;
  const previewH = Math.max(1, props.height - previewY - pad);
  const viewportWidth = Math.min(4096, Math.max(160, Math.floor(props.width - pad * 2))),
    viewportHeight = Math.min(2048, Math.max(160, Math.floor(previewH)));
  const { sample, size, page } = props.rendered;
  useEffect(() => {
    let alive = true,
      loaded: Preview | null = null;
    const controller = new AbortController();
    setPreview(null);
    setError("");
    void fontPreview(props.file, sample, size, controller.signal, {
      width: viewportWidth,
      height: viewportHeight,
      page,
    }).then(
      (value) => {
        loaded = value.preview;
        if (alive) {
          setPreview(value.preview);
          if (value.page !== page) props.onPage(value.page);
          props.onPageCount(value.pageCount);
          props.onFace({ family: value.family, style: value.style });
        } else void value.preview.dispose();
      },
      (reason) => {
        if (alive) {
          props.onPageCount(0);
          setError(errorText(reason));
          props.onError(errorText(reason));
        }
      },
    );
    return () => {
      alive = false;
      controller.abort();
      if (loaded) void loaded.dispose();
    };
  }, [props.file, sample, size, page, viewportWidth, viewportHeight]);
  return (
    <Box width={props.width} height={props.height}>
      <TextArea
        x={pad}
        y={pad}
        width={props.width - pad * 2}
        height={sampleH}
        value={props.sample}
        focusId="font:sample"
        onChange={props.onSample}
        placeholder="Sample text in the selected font"
      />
      <Horizontal
        x={pad}
        y={pagerY}
        width={props.width - pad * 2}
        height={32 * ui}
        gap={2 * ui}
        align="center"
      >
        <ToolButton
          icon="chevron-left"
          tooltip="Previous page"
          tooltipPlacement="top"
          focusId="font-page-previous"
          disabled={props.pageCount === 0 || page <= 0}
          onPress={() => props.onPage(page - 1)}
        />
        <ToolReadout
          width={110 * ui}
          text={props.pageCount ? `Page ${page + 1} of ${props.pageCount}` : "No preview"}
        />
        <ToolButton
          icon="chevron-right"
          tooltip="Next page"
          tooltipPlacement="top"
          focusId="font-page-next"
          disabled={props.pageCount === 0 || page + 1 >= props.pageCount}
          onPress={() => props.onPage(page + 1)}
        />
      </Horizontal>
      {preview ? (
        <Box x={pad} y={previewY} width={props.width - pad * 2} height={previewH}>
          <ImageWidget
            width={props.width - pad * 2}
            height={previewH}
            bitmap={preview.bitmap}
            fit="contain"
          />
        </Box>
      ) : (
        <Box x={pad} y={previewY} width={props.width - pad * 2} height={previewH}>
          <TextBlock
            width={props.width - pad * 2}
            height={previewH}
            text={error || "Rendering preview…"}
            color={error ? pal.danger : pal.muted}
            fontSize={12}
            wrap
            horizontalAlign="center"
            verticalAlign="center"
          />
        </Box>
      )}
    </Box>
  );
}
