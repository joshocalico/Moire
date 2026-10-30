/** The top bar's search field: the query's finished tokens as chips, the rest as text. */
import React, { useMemo, useRef, type ReactNode } from "react";
import { TokenField, usePalette, type HitKeyEvent } from "@moire/ui";
import { parseFileKind } from "@moire/file-operations";
import { kindTint } from "#files/kind-style";
import { fieldCompletions, joinField, splitField } from "#files/search/field";
import type { CompletionContext } from "#files/search/query";

export const SEARCH_FOCUS_ID = "files:search";

export function SearchField(props: {
  width: number;
  height: number;
  text: string;
  placeholder: string;
  /** Bumped to move focus into the field. */
  focusRequest: number;
  completion: CompletionContext;
  trailingText?: string;
  onTextChange(text: string): void;
  onFocusChange(focused: boolean): void;
  onKeyDown(event: HitKeyEvent): boolean;
  onSubmit(): void;
  onEscape(): void;
}): ReactNode {
  const pal = usePalette();
  const parts = useMemo(() => splitField(props.text), [props.text]);
  const tokens = parts.tokens.map((token) => ({
    ...token,
    tint:
      token.key === "kind"
        ? kindTint(parseFileKind(token.value) ?? "other", pal)
        : token.key === "when"
          ? kindTint("document", pal)
          : undefined,
  }));
  const completions = fieldCompletions(parts.value, props.completion);
  // The clear button changes tokens then text in one turn; each step builds on the last.
  const latest = useRef(props.text);
  latest.current = props.text;
  const change = (text: string) => {
    latest.current = text;
    props.onTextChange(text);
  };
  return (
    <TokenField
      // A focus request remounts the field so it takes focus with the caret after its text.
      key={`search-${props.focusRequest}`}
      width={props.width}
      height={props.height}
      size="small"
      focusId={SEARCH_FOCUS_ID}
      autoFocus={props.focusRequest > 0}
      tokens={tokens}
      value={parts.value}
      placeholder={props.placeholder}
      trailingText={props.trailingText}
      completions={completions}
      onChange={(value) => change(joinField(splitField(latest.current).tokens, value))}
      onTokensChange={(next) => {
        const current = splitField(latest.current);
        change(
          joinField(
            current.tokens.filter((token) => next.some((kept) => kept.id === token.id)),
            current.value,
          ),
        );
      }}
      onFocusChange={props.onFocusChange}
      onKeyDown={props.onKeyDown}
      onSubmit={props.onSubmit}
      onEscape={props.onEscape}
    />
  );
}
