/**
 * Read-only source with light syntax colouring: comments (line and block, across lines),
 * strings (and Python's triple-quoted ones), numbers, keywords, markup tags and config keys, for
 * the languages people keep in their home folders. Colours follow the theme's lightness.
 */
import React, { type ReactNode } from "react";
import { RichTextView, type RichTextLine } from "./rich-text";
import { useWidgetTheme } from "#ui/widget-theme";

export type CodeLanguage =
  | "tsx"
  | "typescript"
  | "javascript"
  | "json"
  | "css"
  | "html"
  | "xml"
  | "shell"
  | "python"
  | "ruby"
  | "rust"
  | "go"
  | "c"
  | "java"
  | "swift"
  | "lua"
  | "sql"
  | "yaml"
  | "toml"
  | "nix"
  | "plain";

export type CodeViewProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  code: string;
  language?: CodeLanguage;
  lineNumbers?: boolean;
  fontSize?: number;
  /** Number shown on the first line, when the code is an excerpt. */
  firstLine?: number;
};

type TokenKind =
  | "plain"
  | "keyword"
  | "string"
  | "number"
  | "comment"
  | "tag"
  | "key"
  | "punctuation";
type Token = { text: string; kind: TokenKind };

type Grammar = {
  lineComments: readonly string[];
  blockComment?: readonly [string, string];
  /** Python's """ and ''' strings, which may span lines. */
  tripleStrings?: boolean;
  quotes: string;
  keywords: ReadonlySet<string>;
  /** `<tag` and `</tag` are tags (markup, JSX). */
  tags?: boolean;
  /** `name:` (YAML) or `name =` (TOML) at the start of a line is a key. */
  keyBefore?: ":" | "=";
  /** A string followed by `:` is a key (JSON). */
  stringKeys?: boolean;
};

const words = (text: string): ReadonlySet<string> => new Set(text.split(" "));

const JS_KEYWORDS = words(
  "import export from as default const let var function return type interface extends implements new if else for while do switch case break continue throw try catch finally class enum true false null undefined async await yield typeof instanceof in of this super void readonly private public protected static declare keyof satisfies",
);
const C_FAMILY =
  "if else for while do switch case break continue return goto struct union enum typedef static const extern sizeof void int char long short unsigned signed float double bool true false NULL nullptr class public private protected virtual template typename namespace using new delete this include define ifdef ifndef endif";

const GRAMMARS: Readonly<Record<Exclude<CodeLanguage, "plain">, Grammar>> = {
  tsx: {
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: "\"'`",
    keywords: JS_KEYWORDS,
    tags: true,
  },
  typescript: {
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: "\"'`",
    keywords: JS_KEYWORDS,
  },
  javascript: {
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: "\"'`",
    keywords: JS_KEYWORDS,
  },
  json: { lineComments: [], quotes: '"', keywords: words("true false null"), stringKeys: true },
  css: {
    lineComments: [],
    blockComment: ["/*", "*/"],
    quotes: "\"'",
    keywords: words("important media import supports keyframes font-face root"),
  },
  html: {
    lineComments: [],
    blockComment: ["<!--", "-->"],
    quotes: "\"'",
    keywords: words(""),
    tags: true,
  },
  xml: {
    lineComments: [],
    blockComment: ["<!--", "-->"],
    quotes: "\"'",
    keywords: words(""),
    tags: true,
  },
  shell: {
    lineComments: ["#"],
    quotes: "\"'",
    keywords: words(
      "if then else elif fi for in do done while until case esac function return local export readonly set unset echo exit source alias",
    ),
  },
  python: {
    lineComments: ["#"],
    tripleStrings: true,
    quotes: "\"'",
    keywords: words(
      "def class return if elif else for while in not and or is import from as with try except finally raise pass break continue lambda yield global nonlocal assert del True False None async await self",
    ),
  },
  ruby: {
    lineComments: ["#"],
    quotes: "\"'",
    keywords: words(
      "def class module end if elsif else unless while until for in do return yield begin rescue ensure raise require true false nil self then case when attr_reader attr_accessor",
    ),
  },
  rust: {
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: '"',
    keywords: words(
      "fn let mut const static struct enum impl trait pub use mod crate self Self super match if else for while loop in return break continue as where move ref async await dyn unsafe true false Some None Ok Err",
    ),
  },
  go: {
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: "\"'`",
    keywords: words(
      "package import func var const type struct interface map chan go defer return if else for range switch case default break continue select true false nil",
    ),
  },
  c: { lineComments: ["//"], blockComment: ["/*", "*/"], quotes: "\"'", keywords: words(C_FAMILY) },
  java: {
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: "\"'",
    keywords: words(
      "package import class interface enum extends implements public private protected static final abstract void int long boolean double float char new return if else for while do switch case break continue try catch finally throw throws this super null true false fun val var object when override",
    ),
  },
  swift: {
    lineComments: ["//"],
    blockComment: ["/*", "*/"],
    quotes: '"',
    keywords: words(
      "import func let var class struct enum protocol extension return if else guard for in while switch case break continue true false nil self init deinit public private static override",
    ),
  },
  lua: {
    lineComments: ["--"],
    quotes: "\"'",
    keywords: words(
      "local function end if then elseif else for in do while repeat until return break true false nil and or not",
    ),
  },
  sql: {
    lineComments: ["--"],
    blockComment: ["/*", "*/"],
    quotes: "'\"",
    keywords: words(
      "select from where insert into values update set delete create table index view drop alter add join left right inner outer on group by order having limit as and or not null primary key references distinct union all SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE INDEX VIEW DROP ALTER ADD JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER HAVING LIMIT AS AND OR NOT NULL PRIMARY KEY REFERENCES DISTINCT UNION ALL",
    ),
  },
  yaml: {
    lineComments: ["#"],
    quotes: "\"'",
    keywords: words("true false null yes no on off"),
    keyBefore: ":",
  },
  toml: { lineComments: ["#"], quotes: "\"'", keywords: words("true false"), keyBefore: "=" },
  nix: {
    lineComments: ["#"],
    blockComment: ["/*", "*/"],
    quotes: '"',
    keywords: words("let in with rec inherit import if then else assert true false null or"),
  },
};

const EXTENSIONS: Readonly<Record<string, CodeLanguage>> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  jsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "css",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  plist: "xml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  c: "c",
  h: "c",
  cc: "c",
  cpp: "c",
  hpp: "c",
  java: "java",
  kt: "java",
  swift: "swift",
  lua: "lua",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "toml",
  conf: "toml",
  nix: "nix",
};

/** The language for a file name ("main.rs", "Makefile"), "plain" when unknown. */
export function codeLanguageFor(name: string): CodeLanguage {
  const base = name.split("/").pop() ?? name;
  if (/^(makefile|dockerfile|\.bashrc|\.zshrc|\.profile)$/i.test(base)) return "shell";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? (EXTENSIONS[base.slice(dot + 1).toLowerCase()] ?? "plain") : "plain";
}

const NUMBER = /^(?:0[xX][\da-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/;
const IDENTIFIER = /^[A-Za-z_$@][\w$]*/;
const TAG = /^<\/?[A-Za-z][\w:.-]*/;
const SPACE = /^\s+/;

/** Tokens of one line, and the delimiter still open at its end (a block comment or string). */
export function tokenizeLine(
  line: string,
  language: CodeLanguage,
  open: { close: string; kind: TokenKind } | null,
): { tokens: Token[]; open: { close: string; kind: TokenKind } | null } {
  if (language === "plain") return { tokens: [{ text: line, kind: "plain" }], open: null };
  const grammar = GRAMMARS[language];
  const tokens: Token[] = [];
  let at = 0;
  if (open) {
    const end = line.indexOf(open.close);
    if (end < 0) return { tokens: [{ text: line, kind: open.kind }], open };
    at = end + open.close.length;
    tokens.push({ text: line.slice(0, at), kind: open.kind });
  }
  const keyMatch =
    grammar.keyBefore && !open
      ? new RegExp(`^(\\s*)([\\w.-]+)(?=\\s*${grammar.keyBefore === "=" ? "=" : ":(\\s|$)"})`).exec(
          line,
        )
      : null;
  if (keyMatch) {
    if (keyMatch[1]) tokens.push({ text: keyMatch[1], kind: "plain" });
    tokens.push({ text: keyMatch[2]!, kind: "key" });
    at = keyMatch[0].length;
  }
  while (at < line.length) {
    const rest = line.slice(at);
    const lineComment = grammar.lineComments.find((start) => rest.startsWith(start));
    if (lineComment) {
      tokens.push({ text: rest, kind: "comment" });
      break;
    }
    const block = grammar.blockComment;
    const triple = grammar.tripleStrings
      ? ['"""', "'''"].find((quote) => rest.startsWith(quote))
      : undefined;
    const opener =
      block && rest.startsWith(block[0])
        ? { start: block[0], close: block[1], kind: "comment" as const }
        : triple
          ? { start: triple, close: triple, kind: "string" as const }
          : null;
    if (opener) {
      const end = rest.indexOf(opener.close, opener.start.length);
      if (end < 0) {
        tokens.push({ text: rest, kind: opener.kind });
        return { tokens, open: { close: opener.close, kind: opener.kind } };
      }
      const length = end + opener.close.length;
      tokens.push({ text: rest.slice(0, length), kind: opener.kind });
      at += length;
      continue;
    }
    const first = rest[0]!;
    let text: string;
    let kind: TokenKind;
    if (grammar.quotes.includes(first)) {
      let end = 1;
      while (end < rest.length && rest[end] !== first) end += rest[end] === "\\" ? 2 : 1;
      text = rest.slice(0, end + 1);
      kind = grammar.stringKeys && /^\s*:/.test(rest.slice(text.length)) ? "key" : "string";
    } else if (grammar.tags && TAG.test(rest)) {
      text = TAG.exec(rest)![0];
      kind = "tag";
    } else if (NUMBER.test(rest) && !/[\w$]/.test(line[at - 1] ?? "")) {
      text = NUMBER.exec(rest)![0];
      kind = "number";
    } else if (IDENTIFIER.test(rest)) {
      text = IDENTIFIER.exec(rest)![0];
      kind = grammar.keywords.has(text) ? "keyword" : "plain";
    } else if (SPACE.test(rest)) {
      text = SPACE.exec(rest)![0];
      kind = "plain";
    } else {
      text = first;
      kind = "punctuation";
    }
    tokens.push({ text, kind });
    at += text.length;
  }
  return { tokens, open: null };
}

/** Relative luminance of an ARGB colour, 0 (black) to 1 (white). */
function luminance(color: number): number {
  const channel = (shift: number) => ((color >>> shift) & 0xff) / 255;
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/** Dark themes keep the classic dark code surface; light themes get light-ground colours. */
const DARK_COLORS = {
  fill: 0xff171b20,
  keyword: 0xffc792ea,
  string: 0xffc3e88d,
  number: 0xfff78c6c,
  tag: 0xff82aaff,
  key: 0xff82aaff,
  punctuation: 0xff89ddff,
};
const LIGHT_COLORS = {
  fill: 0xfff6f7f9,
  keyword: 0xff8839ef,
  string: 0xff40a02b,
  number: 0xffd2570b,
  tag: 0xff1e66f5,
  key: 0xff1e66f5,
  punctuation: 0xff179299,
};

export function CodeView(props: CodeViewProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const dark = luminance(pal.bg) < 0.5;
  const scheme = dark ? DARK_COLORS : LIGHT_COLORS;
  const text = dark ? 0xffd6dde5 : pal.text;
  const colors: Record<TokenKind, number> = { ...scheme, plain: text, comment: pal.muted };
  const language = props.language ?? "tsx";
  let open: Parameters<typeof tokenizeLine>[2] = null;
  const richLines: RichTextLine[] = props.code
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, "  ")
    .split("\n")
    .map((line, index) => {
      const result = tokenizeLine(line, language, open);
      open = result.open;
      return {
        id: String(index),
        runs: result.tokens.map((token) => ({
          text: token.text,
          color: colors[token.kind],
          fontFamily: "mono" as const,
          fontWeight:
            token.kind === "keyword" || token.kind === "tag"
              ? ("medium" as const)
              : ("regular" as const),
        })),
      };
    });
  return (
    <RichTextView
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      lines={richLines}
      fontSize={props.fontSize ?? 12}
      fill={scheme.fill}
      lineNumbers={props.lineNumbers !== false}
      firstLine={props.firstLine}
    />
  );
}
