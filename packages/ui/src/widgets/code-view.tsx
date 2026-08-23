import React, { type ReactNode } from "react";
import { RichTextView, type RichTextLine } from "./rich-text.js";
import { useWidgetTheme } from "../widget-theme.js";

export type CodeLanguage = "tsx" | "typescript" | "javascript" | "shell" | "plain";
export type CodeViewProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  code: string;
  language?: CodeLanguage;
  lineNumbers?: boolean;
  fontSize?: number;
};

type Token = { text: string; kind: "plain" | "keyword" | "string" | "number" | "comment" | "tag" | "punctuation" };
const KEYWORDS = new Set(["import", "export", "from", "const", "let", "function", "return", "type", "interface", "extends", "new", "if", "else", "true", "false", "null", "undefined", "async", "await"]);

function tokenize(line: string, language: CodeLanguage): Token[] {
  if (language === "plain") return [{ text: line, kind: "plain" }];
  const tokens: Token[] = [];
  const pattern = /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|<\/?[A-Za-z][\w.-]*|[^\w\s]+|\s+)/g;
  for (const match of line.matchAll(pattern)) {
    const text = match[0];
    let kind: Token["kind"] = "plain";
    if (text.startsWith("//") || (language === "shell" && text.startsWith("#"))) kind = "comment";
    else if (/^["'`]/.test(text)) kind = "string";
    else if (/^\d/.test(text)) kind = "number";
    else if (KEYWORDS.has(text)) kind = "keyword";
    else if (/^<\/?[A-Za-z]/.test(text)) kind = "tag";
    else if (/^[^\w\s]+$/.test(text)) kind = "punctuation";
    tokens.push({ text, kind });
  }
  return tokens;
}

export function CodeView(props: CodeViewProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const fontSize = props.fontSize ?? 12;
  const lines = props.code.replace(/\r\n/g, "\n").split("\n");
  const colors: Record<Token["kind"], number> = {
    plain: pal.text,
    keyword: 0xffc792ea,
    string: 0xffc3e88d,
    number: 0xfff78c6c,
    comment: pal.muted,
    tag: 0xff82aaff,
    punctuation: 0xff89ddff,
  };
  const richLines: RichTextLine[] = lines.map((line, index) => ({
    id: String(index),
    runs: tokenize(line, props.language ?? "tsx").map((token) => ({
      text: token.text,
      color: colors[token.kind],
      fontFamily: "mono" as const,
      fontWeight:
        token.kind === "keyword" || token.kind === "tag"
          ? ("medium" as const)
          : ("regular" as const),
    })),
  }));
  return (
    <RichTextView
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      lines={richLines}
      fontSize={fontSize}
      lineNumbers={props.lineNumbers !== false}
    />
  );
}
