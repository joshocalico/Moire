import React, { useEffect, useState, type ReactNode } from "react";
import path from "node:path";
import os from "node:os";
import {
  Column,
  Box,
  Surface,
  Label,
  Icon,
  Separator,
  ScrollColumn,
  ImageWidget,
  Button,
  TextField,
  Row,
  Horizontal,
  TextBlock,
  IconButton,
  Disclosure,
  writeClipboardText,
  getUiScaleFactor,
  usePalette,
  measureWrappedText,
  useWidgetTheme,
} from "@moire/ui";
import { inspectFiles, type Inspection } from "./inspection";
import { fileType, operationError, type Entry } from "./filesystem";
import { formatBytes } from "./format";

/** Interpret only raw byte fields; storage capacity is already formatted by inspection. */
export function inspectionValue(key: string, value: string): string {
  if (key === "File bytes") return formatBytes(Number(value.replaceAll(",", "")));
  if (key === "Location" && (value === os.homedir() || value.startsWith(os.homedir() + path.sep)))
    return `~${value.slice(os.homedir().length)}`;
  return value;
}

export function inspectionModifiedAt(timestamp: number, includeYear = false): string {
  return new Date(timestamp).toLocaleString(undefined, {
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FileInspector(props: {
  width: number;
  height: number;
  entries: Entry[];
  cwd: string;
  refresh: number;
  tags: readonly string[];
  tagsReady: boolean;
  busy: boolean;
  onTags: (value: string, mode: "add" | "remove") => void;
  onTextFocus: (focused: boolean) => void;
  onOpen: (entry: Entry) => void;
  onReveal: (entry: Entry) => void;
  onRename: (entry: Entry) => void;
  onActions: () => void;
  onClose?: () => void;
}): ReactNode {
  const pal = usePalette(),
    ui = getUiScaleFactor();
  const tagRecipe = useWidgetTheme().recipes.button.secondary.small;
  const pad = Math.round(16 * ui),
    width = Math.max(1, props.width - pad * 2);
  const entry = props.entries.length === 1 ? props.entries[0] : null;
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const filesKey = props.entries.map((entry) => `${entry.path}:${entry.modified}`).join("\n");
  useEffect(() => {
    let alive = true;
    setInspection(null);
    setTagDraft("");
    void inspectFiles(props.entries, props.cwd).then(
      (value) => {
        if (alive) setInspection(value);
      },
      (error) => {
        if (alive) setInspection({ details: [], error: operationError(error) });
      },
    );
    return () => {
      alive = false;
    };
    // The immutable key includes every selected file and its current revision.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, props.cwd, props.refresh]);
  const details = inspection?.details ?? [];
  const title =
    entry?.name ??
    (props.entries.length
      ? `${props.entries.length} items selected`
      : path.basename(props.cwd) || "Filesystem");
  const titleHeight = Math.min(44 * ui, measureWrappedText(title, width, { fontSize: 20 }).height);
  const detail = (key: string) => details.find(([name]) => name === key)?.[1];
  const primary = (
    props.entries.length > 1
      ? ["Selection", "File bytes", "Modified range", "Location"]
      : entry?.isDir || !entry
        ? ["Contents", "Available bytes", "Modified", "Location"]
        : ["File bytes", "Dimensions", "Modified", "Created", "Location"]
  ).flatMap((key) => {
    const value = key === "Location" && !props.entries.length ? props.cwd : detail(key);
    return value
      ? [
          [
            key === "File bytes" ? "Size" : key === "Available bytes" ? "Available" : key,
            key === "Modified" && inspection?.modifiedAt !== undefined
              ? inspectionModifiedAt(inspection.modifiedAt)
              : key === "Modified range" && inspection?.modifiedRange
                ? inspection.modifiedRange
                    .map((timestamp) => inspectionModifiedAt(timestamp, true))
                    .join(" —\n")
                : inspectionValue(key, value),
          ] satisfies [string, string],
        ]
      : [];
  });
  const primaryKeys = new Set(
    primary.map(([key]) =>
      key === "Size" ? "File bytes" : key === "Available" ? "Available bytes" : key,
    ),
  );
  const extra = details.filter(([key]) => !primaryKeys.has(key));
  const previewHeight = Math.round(
    (inspection?.png
      ? Math.min((width / ui) * 0.8, 240)
      : inspection?.text !== undefined
        ? 160
        : 96) * ui,
  );
  const metadataWidth = Math.max(1, width - 24 * ui);
  const metadataGap = 6 * ui;
  const labelWidth = Math.min(
    metadataWidth,
    Math.max(
      0,
      ...[...primary, ...extra].map(
        ([key]) =>
          measureWrappedText(key, metadataWidth, { fontSize: 13, fontWeight: "medium" }).width,
      ),
    ),
  );
  const prepareMetadata = (rows: Array<[string, string]>) =>
    rows.map(([key, value]) => {
      const valueNatural = measureWrappedText(value, metadataWidth, { fontSize: 13 });
      const stacked =
        value.includes("\n") || labelWidth + 12 * ui + valueNatural.width > metadataWidth;
      const valueWidth = stacked
        ? metadataWidth
        : Math.max(1, metadataWidth - labelWidth - 12 * ui);
      const labelHeight = measureWrappedText(key, stacked ? metadataWidth : labelWidth, {
        fontSize: 13,
        fontWeight: "medium",
      }).height;
      const valueHeight = measureWrappedText(value, valueWidth, { fontSize: 13 }).height;
      return {
        key,
        value,
        stacked,
        valueWidth,
        height:
          12 * ui +
          (stacked ? labelHeight + metadataGap + valueHeight : Math.max(labelHeight, valueHeight)) +
          1,
      };
    });
  const primaryRows = prepareMetadata(primary);
  const extraRows = prepareMetadata(extra);
  const advancedHeight = extraRows.reduce((height, row) => height + row.height, 0);
  const tagEditorHeight = editingTags ? 72 * ui : 0;
  const actionsHeight = actionsOpen ? (entry ? 166 : 30) * ui : 0;
  const metadata = (rows: ReturnType<typeof prepareMetadata>) =>
    rows.map(({ key, value, stacked, valueWidth }) => (
      <Column key={key} width={width} gap={0}>
        <Column width={width} padding={{ horizontal: 12 * ui, vertical: 6 * ui }} gap={metadataGap}>
          {stacked ? (
            <>
              <TextBlock
                width={metadataWidth}
                text={key}
                fontSize={13}
                fontWeight="medium"
                color={pal.text}
                wrap
              />
              <TextBlock width={valueWidth} text={value} fontSize={13} color={pal.text} wrap />
            </>
          ) : (
            <Row width={metadataWidth} gap={12 * ui} align="center">
              <TextBlock
                width={labelWidth}
                text={key}
                fontSize={13}
                fontWeight="medium"
                color={pal.text}
                wrap
              />
              <TextBlock width={valueWidth} text={value} fontSize={13} color={pal.text} wrap />
            </Row>
          )}
        </Column>
        <Separator width={width} height={1} />
      </Column>
    ));
  const addTags = () => {
    if (tagDraft.trim()) {
      props.onTags(tagDraft, "add");
      setTagDraft("");
    }
  };
  return (
    <Surface width={props.width} height={props.height} fill={pal.panel}>
      <ScrollColumn width={props.width} height={props.height} padding={pad} gap={10 * ui}>
        <Row width={width} height={28 * ui} align="center">
          <TextBlock text="Preview" fontSize={14} color={pal.muted} flexGrow={1} />
          {props.onClose ? (
            <IconButton
              width={28 * ui}
              height={28 * ui}
              variant="ghost"
              icon={<Icon symbolic name="close" size={14} />}
              tooltip="Close preview"
              onPress={props.onClose}
            />
          ) : null}
        </Row>
        {inspection?.png ? (
          <ImageWidget width={width} height={previewHeight} src={inspection.png} fit="contain" />
        ) : inspection?.text !== undefined ? (
          <Surface width={width} height={previewHeight} fill={pal.bg} radius={pal.radiusMd} clip>
            <Label
              width={width}
              height={previewHeight}
              text={inspection.text || "Empty text file"}
              fontFamily="mono"
              fontSize={11}
              wrap
              maxLines={9}
              overflow="ellipsis"
            />
          </Surface>
        ) : (
          <Surface width={width} height={previewHeight} fill={pal.surface} radius={pal.radiusMd}>
            <Horizontal width={width} height={previewHeight} justify="center" align="center">
              <Box width={56 * ui} height={56 * ui}>
                <Icon
                  symbolic
                  size={56 * ui}
                  name={entry?.isDir || !entry ? "folder-filled" : "file"}
                  color={pal.accent}
                />
              </Box>
            </Horizontal>
          </Surface>
        )}
        <TextBlock
          width={width}
          height={titleHeight}
          text={title}
          fontSize={20}
          fontWeight="medium"
          wrap
          maxLines={2}
          overflow="ellipsis"
        />
        <TextBlock
          width={width}
          height={24 * ui}
          text={
            entry
              ? fileType(entry)
              : props.entries.length
                ? `${formatBytes(props.entries.filter((item) => !item.isDir).reduce((total, item) => total + item.size, 0))} in selected files`
                : "Current folder"
          }
          fontSize={12}
          color={pal.muted}
          maxLines={1}
          overflow="ellipsis"
        />
        {!inspection ? (
          <TextBlock
            text="Reading current metadata…"
            fontSize={12}
            color={pal.muted}
            height={24 * ui}
          />
        ) : null}
        {inspection?.error ? (
          <TextBlock text={inspection.error} fontSize={12} height={64 * ui} wrap maxLines={4} />
        ) : null}
        <Column width={width} gap={0}>
          {metadata(primaryRows)}
        </Column>
        <Separator width={width} />
        <TextBlock width={width} height={24 * ui} text="Tags" fontSize={13} color={pal.muted} />
        {props.tags.length ? (
          <Row width={width} wrap gap={6 * ui}>
            {props.tags.map((tag) => (
              <Button
                key={tag}
                label={`${tag} ×`}
                width={Math.min(
                  width,
                  Math.ceil(
                    measureWrappedText(`${tag} ×`, width, {
                      fontSize: tagRecipe.label.base.fontSize,
                      fontWeight: tagRecipe.label.base.fontWeight,
                    }).width,
                  ) +
                    tagRecipe.metrics.paddingX * 2 +
                    2,
                )}
                size="small"
                height={28 * ui}
                variant="secondary"
                disabled={!props.tagsReady || props.busy}
                onPress={() => props.onTags(tag, "remove")}
              />
            ))}
          </Row>
        ) : null}
        {props.entries.length ? (
          <Disclosure
            width={width}
            headerHeight={40 * ui}
            title="Edit tags"
            expanded={editingTags}
            onExpandedChange={setEditingTags}
            contentHeight={tagEditorHeight}
          >
            <Column width={width} gap={8 * ui}>
              <TextField
                width={width}
                height={32 * ui}
                value={tagDraft}
                placeholder="work, ideas…"
                disabled={!props.tagsReady || props.busy}
                onFocusChange={props.onTextFocus}
                onChange={setTagDraft}
                onSubmit={addTags}
              />
              <Button
                height={32 * ui}
                label="Add tags"
                disabled={!props.tagsReady || props.busy || !tagDraft.trim()}
                onPress={addTags}
              />
            </Column>
          </Disclosure>
        ) : null}
        <Disclosure
          width={width}
          headerHeight={40 * ui}
          title="More details"
          expanded={advanced}
          onExpandedChange={setAdvanced}
          contentHeight={advancedHeight}
        >
          <Column width={width} gap={0}>
            {metadata(extraRows)}
          </Column>
        </Disclosure>
        {props.entries.length ? (
          <Disclosure
            width={width}
            headerHeight={40 * ui}
            title="Selection actions"
            expanded={actionsOpen}
            onExpandedChange={setActionsOpen}
            contentHeight={actionsHeight}
          >
            <Column width={width} gap={4 * ui}>
              {entry ? (
                <>
                  <Button
                    height={30 * ui}
                    label={entry.isDir ? "Open folder" : "Open file"}
                    onPress={() => props.onOpen(entry)}
                  />
                  <Button
                    variant="ghost"
                    height={30 * ui}
                    label="Show containing folder"
                    onPress={() => props.onReveal(entry)}
                  />
                  <Button
                    variant="ghost"
                    height={30 * ui}
                    label="Rename…"
                    disabled={props.busy}
                    onPress={() => props.onRename(entry)}
                  />
                  <Button
                    height={30 * ui}
                    variant="ghost"
                    label="Copy full path"
                    onPress={() => {
                      void writeClipboardText(entry.path).catch((error) =>
                        setInspection({ details, error: operationError(error) }),
                      );
                    }}
                  />
                </>
              ) : null}
              <Button
                height={30 * ui}
                label="Organise selection…"
                disabled={props.busy}
                onPress={props.onActions}
              />
            </Column>
          </Disclosure>
        ) : null}
      </ScrollColumn>
    </Surface>
  );
}
