/**
 * A small Markdown reader for previews: headings, paragraphs, lists (with task boxes), fenced and
 * indented code, quotes, rules and tables. Inline marks are reduced to their text, because the
 * view draws each block in one style.
 */

export type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | {
      kind: "item";
      /** "•" or "1."; empty for a task, which has a box instead. */
      marker: string;
      /** A task list item: whether its box is ticked. */
      done?: boolean;
      depth: number;
      text: string;
    }
  | { kind: "code"; language: string; lines: string[] }
  | { kind: "quote"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "rule" };

const FENCE = /^\s*(```|~~~)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SETEXT = /^\s*(=+|-+)\s*$/;
const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** Inline Markdown as plain text: emphasis, code spans, links and images keep only their words. */
export function markdownInline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1");
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length)
      blocks.push({ kind: "paragraph", text: markdownInline(paragraph.join(" ")) });
    paragraph = [];
  };
  let index = 0;
  // Front matter is metadata, not content.
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end > 0) index = end + 1;
  }
  for (; index < lines.length; index++) {
    const line = lines[index]!;
    const fence = FENCE.exec(line);
    if (fence) {
      flush();
      const code: string[] = [];
      for (
        index++;
        index < lines.length && !lines[index]!.trimStart().startsWith(fence[1]!);
        index++
      )
        code.push(lines[index]!);
      blocks.push({ kind: "code", language: fence[2] ?? "", lines: code });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    // A paragraph's last line underlined with === or --- is a heading.
    if (paragraph.length && SETEXT.test(line)) {
      const text = markdownInline(paragraph.join(" "));
      paragraph = [];
      blocks.push({ kind: "heading", level: line.trim()[0] === "=" ? 1 : 2, text });
      continue;
    }
    if (RULE.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        text: markdownInline(heading[2]!),
      });
      continue;
    }
    const item = ITEM.exec(line);
    if (item) {
      flush();
      const [, indent, bullet, task, text] = item;
      const depth = Math.floor(indent!.length / 2);
      blocks.push(
        task !== undefined
          ? { kind: "item", marker: "", done: task !== " ", depth, text: markdownInline(text!) }
          : {
              kind: "item",
              marker: /\d/.test(bullet!) ? bullet! : "•",
              depth,
              text: markdownInline(text!),
            },
      );
      continue;
    }
    if (line.startsWith(">")) {
      flush();
      const quote: string[] = [];
      for (; index < lines.length && lines[index]!.startsWith(">"); index++)
        quote.push(lines[index]!.replace(/^>\s?/, ""));
      index--;
      blocks.push({ kind: "quote", text: markdownInline(quote.join(" ")) });
      continue;
    }
    if (line.includes("|") && TABLE_DIVIDER.test(lines[index + 1] ?? "")) {
      flush();
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => markdownInline(cell.trim()));
      const rows = [cells(line)];
      for (index += 2; index < lines.length && lines[index]!.includes("|"); index++)
        rows.push(cells(lines[index]!));
      index--;
      blocks.push({ kind: "table", rows });
      continue;
    }
    // Four spaces indent a code block, unless they continue a paragraph.
    if (!paragraph.length && line.startsWith("    ")) {
      const code: string[] = [];
      for (
        ;
        index < lines.length && (lines[index]!.startsWith("    ") || !lines[index]!.trim());
        index++
      )
        code.push(lines[index]!.slice(4));
      index--;
      while (code.length && !code.at(-1)!.trim()) code.pop();
      blocks.push({ kind: "code", language: "", lines: code });
      continue;
    }
    paragraph.push(line.trim());
  }
  flush();
  return blocks;
}
