export type Calculation = { expression: string; value: number; formatted: string };
type Token =
  | { kind: "number"; value: number }
  | { kind: "operator"; value: string }
  | { kind: "end" };
function tokenize(expression: string): Token[] {
  if (expression.length > 2048) throw new Error("Expression is too long.");
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < expression.length) {
    if (/\s/.test(expression[offset]!)) {
      offset++;
      continue;
    }
    const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(expression.slice(offset));
    if (numeric) {
      const value = Number(numeric[0]);
      if (!Number.isFinite(value)) throw new Error("Number is too large.");
      tokens.push({ kind: "number", value });
      offset += numeric[0].length;
      continue;
    }
    const operator = expression[offset++]!;
    if (!"+-*/%^()×÷".includes(operator)) throw new Error(`Unexpected character '${operator}'.`);
    tokens.push({
      kind: "operator",
      value: operator === "×" ? "*" : operator === "÷" ? "/" : operator,
    });
  }
  return [...tokens, { kind: "end" }];
}
export function calculate(expression: string): Calculation {
  const tokens = tokenize(expression);
  let index = 0;
  const peek = () => tokens[index] ?? ({ kind: "end" } satisfies Token);
  const operator = (value: string): boolean => {
    const token = peek();
    return token.kind === "operator" && token.value === value;
  };
  const primary = (): number => {
    const token = peek();
    if (token.kind === "number") {
      index++;
      return token.value;
    }
    if (operator("(")) {
      index++;
      const value = sum();
      if (!operator(")")) throw new Error("Close the parenthesis.");
      index++;
      return value;
    }
    throw new Error("Expected a number or parenthesis.");
  };
  const power = (): number => {
    const left = primary();
    if (operator("^")) {
      index++;
      return left ** unary();
    }
    return left;
  };
  const unary = (): number => {
    if (operator("+")) {
      index++;
      return unary();
    }
    if (operator("-")) {
      index++;
      return -unary();
    }
    return power();
  };
  const product = (): number => {
    let value = unary();
    while (operator("*") || operator("/") || operator("%")) {
      const token = peek();
      index++;
      const right = unary();
      if (token.kind !== "operator") throw new Error("Expected an operator.");
      if ((token.value === "/" || token.value === "%") && right === 0)
        throw new Error("Cannot divide by zero.");
      value =
        token.value === "*" ? value * right : token.value === "/" ? value / right : value % right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (operator("+") || operator("-")) {
      const add = operator("+");
      index++;
      const right = product();
      value = add ? value + right : value - right;
    }
    return value;
  };
  if (!expression.trim()) throw new Error("Enter an expression.");
  const value = sum();
  if (peek().kind !== "end") throw new Error("Expected an operator between terms.");
  if (!Number.isFinite(value)) throw new Error("Result is outside the supported number range.");
  const formatted = Number.parseFloat(value.toPrecision(12)).toString();
  return { expression, value, formatted };
}
