#!/usr/bin/env -S node --import tsx
/**
 * Generate Moire's TypeScript Wayland wire bindings from protocol XML.
 *
 * This intentionally has no XML or Wayland runtime dependency. The small XML
 * reader below retains only the element/attribute tree needed by protocol
 * descriptions; generated bindings target Moire's own TypeScript wire codec.
 */
import fs from "node:fs";
import path from "node:path";

type XmlNode = {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
};

type WireType =
  | "int"
  | "uint"
  | "fixed"
  | "object"
  | "new_id"
  | "string"
  | "array"
  | "fd";

const TYPE_MAP: Record<WireType, string> = {
  int: "number",
  uint: "number",
  fixed: "number",
  object: "number",
  new_id: "number",
  string: "string",
  array: "Buffer",
  fd: "number",
};

const ENCODE_METHOD: Record<WireType, string> = {
  int: "int",
  uint: "uint",
  fixed: "fixed",
  object: "object",
  new_id: "newId",
  string: "string",
  array: "array",
  fd: "fd",
};

const DECODE_METHOD: Record<WireType, string> = {
  int: "int",
  uint: "uint",
  fixed: "fixed",
  object: "object",
  new_id: "newId",
  string: "string",
  array: "array",
  fd: "fd",
};

const TS_RESERVED = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "enum", "export", "extends",
  "false", "finally", "for", "function", "if", "import", "in",
  "instanceof", "new", "null", "return", "super", "switch", "this",
  "throw", "true", "try", "typeof", "var", "void", "while", "with",
  "as", "implements", "interface", "let", "package", "private",
  "protected", "public", "static", "yield", "any", "boolean",
  "constructor", "declare", "get", "module", "require", "number",
  "set", "string", "symbol", "type", "from", "of", "targetId",
]);

const DEFAULT_XML = [
  "/usr/share/wayland/wayland.xml",
  "/usr/share/wayland-protocols/stable/xdg-shell/xdg-shell.xml",
  "/usr/share/wayland-protocols/unstable/xdg-decoration/xdg-decoration-unstable-v1.xml",
  "/usr/share/wayland-protocols/unstable/linux-dmabuf/linux-dmabuf-unstable-v1.xml",
];

function decodeXmlEntities(value: string): string {
  return value.replace(
    /&(?:#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g,
    (entity) => {
      if (entity.startsWith("&#x")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(3, -1), 16));
      }
      if (entity.startsWith("&#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2, -1), 10));
      }
      return {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      }[entity]!;
    },
  );
}

/** Parse enough XML for Wayland protocol documents without a package dep. */
function parseXml(source: string, filename: string): XmlNode {
  const documentNode: XmlNode = {
    name: "#document",
    attributes: {},
    children: [],
  };
  const stack = [documentNode];
  const tags = source.matchAll(
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[\s\S]*?>|<\/?[A-Za-z_][^>]*>/g,
  );

  for (const match of tags) {
    const token = match[0];
    if (token.startsWith("<?") || token.startsWith("<!")) continue;
    if (token.startsWith("</")) {
      const closingName = token.slice(2, -1).trim();
      const open = stack.pop();
      if (!open || open.name !== closingName) {
        throw new Error(
          `${filename}: mismatched closing tag ${closingName}; expected ${open?.name ?? "none"}`,
        );
      }
      continue;
    }

    const selfClosing = /\/\s*>$/.test(token);
    const inner = token.slice(1, selfClosing ? token.lastIndexOf("/") : -1).trim();
    const nameMatch = /^([^\s/>]+)/.exec(inner);
    if (!nameMatch) throw new Error(`${filename}: invalid tag ${token}`);
    const node: XmlNode = { name: nameMatch[1]!, attributes: {}, children: [] };
    const attributes = inner.slice(nameMatch[0].length);
    const attributePattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    for (const attribute of attributes.matchAll(attributePattern)) {
      node.attributes[attribute[1]!] = decodeXmlEntities(
        attribute[2] ?? attribute[3] ?? "",
      );
    }
    stack.at(-1)!.children.push(node);
    if (!selfClosing) stack.push(node);
  }

  if (stack.length !== 1) {
    throw new Error(`${filename}: unclosed tag ${stack.at(-1)!.name}`);
  }
  const root = documentNode.children.find((node) => node.name === "protocol");
  if (!root) throw new Error(`${filename}: missing protocol root`);
  return root;
}

function children(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((child) => child.name === name);
}

function required(node: XmlNode, attribute: string): string {
  const value = node.attributes[attribute];
  if (value === undefined) {
    throw new Error(`<${node.name}> is missing required ${attribute}`);
  }
  return value;
}

function wireType(arg: XmlNode): WireType {
  const value = required(arg, "type");
  if (!(value in TYPE_MAP)) throw new Error(`Unsupported wire type: ${value}`);
  return value as WireType;
}

function camel(name: string): string {
  const parts = name.split(/[_\-.]+/);
  return (
    parts[0]! +
    parts
      .slice(1)
      .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
      .join("")
  );
}

function ident(name: string): string {
  let value = camel(name);
  if (!value || /^\d/.test(value)) value = `value${value}`;
  if (TS_RESERVED.has(value)) value += "Value";
  return value;
}

function argType(arg: XmlNode): string {
  const type = wireType(arg);
  let value = TYPE_MAP[type];
  if (
    arg.attributes["allow-null"] === "true" &&
    (type === "object" || type === "string")
  ) {
    value += " | null";
  }
  return value;
}

function encodeExpression(arg: XmlNode, name: string): string {
  const type = wireType(arg);
  if (arg.attributes["allow-null"] === "true" && type === "object") {
    return `builder.object(${name} ?? 0);`;
  }
  return `builder.${ENCODE_METHOD[type]}(${name});`;
}

function decodeExpression(arg: XmlNode): string {
  const type = wireType(arg);
  let expression = `reader.${DECODE_METHOD[type]}()`;
  if (arg.attributes["allow-null"] === "true" && type === "object") {
    expression = `(${expression} || null)`;
  }
  return expression;
}

function emitMessage(
  message: XmlNode,
  opcode: number,
  request: boolean,
  indent: string,
): string[] {
  const name = ident(required(message, "name"));
  const since = Number.parseInt(message.attributes.since ?? "1", 10);
  const destructor = message.attributes.type === "destructor";
  const args = children(message, "arg");
  const lines = [
    `${indent}${name}: {`,
    `${indent}  opcode: ${opcode},`,
    `${indent}  since: ${since},`,
  ];

  if (request) {
    lines.push(`${indent}  destructor: ${destructor},`);
    const params = ["targetId: number"];
    for (const arg of args) {
      if (wireType(arg) === "new_id" && arg.attributes.interface === undefined) {
        params.push(
          "interfaceValue: string",
          "version: number",
          `${ident(required(arg, "name"))}: number`,
        );
      } else {
        params.push(`${ident(required(arg, "name"))}: ${argType(arg)}`);
      }
    }
    lines.push(
      `${indent}  encode(${params.join(", ")}): EncodedWaylandMessage {`,
      `${indent}    const builder = new MessageBuilder();`,
    );
    for (const arg of args) {
      const argName = ident(required(arg, "name"));
      if (wireType(arg) === "new_id" && arg.attributes.interface === undefined) {
        lines.push(
          `${indent}    builder.string(interfaceValue);`,
          `${indent}    builder.uint(version);`,
          `${indent}    builder.newId(${argName});`,
        );
      } else {
        lines.push(`${indent}    ${encodeExpression(arg, argName)}`);
      }
    }
    lines.push(
      `${indent}    return builder.build(targetId, ${opcode});`,
      `${indent}  },`,
    );
  } else {
    lines.push(`${indent}  decodeReader(reader: MessageReader) {`);
    if (args.length > 0) {
      lines.push(`${indent}    return {`);
      for (const arg of args) {
        lines.push(
          `${indent}      ${ident(required(arg, "name"))}: ${decodeExpression(arg)},`,
        );
      }
      lines.push(`${indent}    };`);
    } else {
      lines.push(`${indent}    void reader;`, `${indent}    return {};`);
    }
    lines.push(
      `${indent}  },`,
      `${indent}  decode(data: Buffer, fds: number[] = []) {`,
    );
    if (args.length > 0) {
      lines.push(
        `${indent}    const reader = new MessageReader(data, fds);`,
        `${indent}    return this.decodeReader(reader);`,
      );
    } else {
      lines.push(
        `${indent}    void data;`,
        `${indent}    void fds;`,
        `${indent}    return {};`,
      );
    }
    lines.push(`${indent}  },`);
  }
  lines.push(`${indent}},`);
  return lines;
}

function normalizeEnumValue(value: string): string {
  if (/^[+-]?(?:0x[0-9a-f]+|\d+)$/i.test(value)) {
    try {
      return BigInt(value).toString(10);
    } catch {
      // Preserve protocol expressions that are valid TypeScript as written.
    }
  }
  return value;
}

function emitInterface(iface: XmlNode): string[] {
  const rawName = required(iface, "name");
  const exportName = ident(rawName);
  const version = Number.parseInt(required(iface, "version"), 10);
  const lines = [
    `export const ${exportName} = {`,
    `  name: ${JSON.stringify(rawName)},`,
    `  version: ${version},`,
    "  requests: {",
  ];
  children(iface, "request").forEach((request, opcode) => {
    lines.push(...emitMessage(request, opcode, true, "    "));
  });
  lines.push("  },", "  events: {");
  children(iface, "event").forEach((event, opcode) => {
    lines.push(...emitMessage(event, opcode, false, "    "));
  });
  lines.push("  },", "  enums: {");
  for (const protocolEnum of children(iface, "enum")) {
    lines.push(`    ${ident(required(protocolEnum, "name"))}: {`);
    for (const entry of children(protocolEnum, "entry")) {
      lines.push(
        `      ${ident(required(entry, "name"))}: ${normalizeEnumValue(required(entry, "value"))},`,
      );
    }
    lines.push("    },");
  }
  lines.push("  },", "} as const;", "");
  return lines;
}

function parseArguments(argv: string[]): { output: string; xml: string[] } {
  const args = [...argv];
  const outputIndex = args.indexOf("--output");
  if (outputIndex < 0 || !args[outputIndex + 1]) {
    throw new Error(
      "usage: generate-wayland-protocol.ts --output FILE [PROTOCOL.xml ...]",
    );
  }
  const output = args[outputIndex + 1]!;
  args.splice(outputIndex, 2);
  if (args.some((arg) => arg.startsWith("-"))) {
    throw new Error(`unknown option: ${args.find((arg) => arg.startsWith("-"))}`);
  }
  return { output, xml: args.length > 0 ? args : DEFAULT_XML };
}

function main(): void {
  const { output, xml } = parseArguments(process.argv.slice(2));
  const missing = xml.filter((filename) => !fs.existsSync(filename));
  if (missing.length > 0) {
    throw new Error(`protocol XML not found: ${missing.join(", ")}`);
  }

  const interfaces = new Map<string, XmlNode>();
  for (const filename of xml) {
    const protocol = parseXml(fs.readFileSync(filename, "utf8"), filename);
    for (const iface of children(protocol, "interface")) {
      interfaces.set(required(iface, "name"), iface);
    }
  }

  const sorted = [...interfaces.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const lines = [
    "/**",
    " * Generated Wayland wire bindings. Do not edit by hand.",
    " *",
    " * Regenerate with scripts/generate-wayland-protocol.ts. The runtime is",
    " * Moire's TypeScript codec and Unix socket implementation—not libwayland.",
    " */",
    'import { MessageBuilder, MessageReader, type EncodedWaylandMessage } from "./index.js";',
    "",
  ];
  for (const [, iface] of sorted) lines.push(...emitInterface(iface));
  lines.push("export const WAYLAND_INTERFACES = {");
  for (const [name] of sorted) lines.push(`  ${ident(name)},`);
  lines.push("} as const;", "");

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, lines.join("\n"), "utf8");
  console.log(
    `generated ${interfaces.size} interfaces from ${xml.length} XML files -> ${output}`,
  );
}

main();
