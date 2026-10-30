/**
 * The search field's two halves. `TokenField` holds finished tokens as chips and the rest as
 * editable text; Files keeps the whole query as one string. A token becomes a chip once it is
 * valid and something follows it, so `kind:im` stays text while it is being typed.
 */
import {
  applyCompletion,
  completeQuery,
  tokenize,
  type CompletionContext,
  type QueryKey,
} from "./query";

export type FieldToken = {
  id: string;
  key: QueryKey;
  value: string;
  label: string;
  source: string;
};
type FieldParts = { tokens: readonly FieldToken[]; value: string };

const WHEN_LABELS: Readonly<Record<string, string>> = {
  today: "today",
  week: "this week",
  month: "this month",
  year: "this year",
};

function tokenLabel(key: QueryKey, value: string): string {
  return `${key}: ${key === "when" ? (WHEN_LABELS[value.toLowerCase()] ?? value) : value}`;
}

export function splitField(text: string): FieldParts {
  const tokens: FieldToken[] = [];
  const seen = new Map<string, number>();
  let value = "";
  let at = 0;
  for (const part of tokenize(text)) {
    if (part.type !== "token" || !part.valid || part.end >= text.length) continue;
    value += text.slice(at, part.start);
    at = part.end;
    const name = `${part.key}:${part.value.toLowerCase()}`;
    const occurrence = seen.get(name) ?? 0;
    seen.set(name, occurrence + 1);
    tokens.push({
      id: occurrence ? `${name}#${occurrence}` : name,
      key: part.key,
      value: part.value,
      label: tokenLabel(part.key, part.value),
      source: text.slice(part.start, part.end),
    });
  }
  value += text.slice(at);
  return { tokens, value: value.replace(/\s{2,}/g, " ").trimStart() };
}

/** The query text for chips and editor text; chips end in a space so they stay chips. */
export function joinField(tokens: readonly Pick<FieldToken, "source">[], value: string): string {
  return tokens.length ? `${tokens.map((token) => token.source).join(" ")} ${value}` : value;
}

type FieldCompletion = { id: string; label: string; detail: string; text: string };

/** Values for a token being typed at the end of the editor text (`kind:im` → `kind:image`). */
export function fieldCompletions(value: string, context: CompletionContext): FieldCompletion[] {
  const set = completeQuery(value, value.length, context);
  if (!set || !value.slice(set.start, set.end).includes(":")) return [];
  return set.items.map((item) => ({
    id: item.insert,
    label: item.label,
    detail: item.detail,
    text: applyCompletion(value, set, item).text,
  }));
}
