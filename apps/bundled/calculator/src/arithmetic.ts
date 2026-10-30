/**
 * A small recursive-descent evaluator. It never hands input to `eval`: anything outside the
 * grammar below is rejected with a message the calculator shows as-is.
 *
 *   sum     = product (("+" | "-") product)*
 *   product = unary (("*" | "/" | "%") unary)*
 *   unary   = ("+" | "-") unary | power
 *   power   = postfix ("^" unary)?
 *   postfix = primary "!"*
 *   primary = number | constant | function "(" sum ")" | "(" sum ")"
 */
export type AngleUnit = "degrees" | "radians";
export type Calculation = {
  expression: string;
  value: number;
  formatted: string;
};
type CalculateOptions = { angle?: AngleUnit };

type Token =
  | { kind: "number"; value: number }
  | { kind: "operator"; value: string }
  | { kind: "name"; value: string }
  | { kind: "end" };

const MAX_LENGTH = 2048;
/** 170! is the largest factorial a double can hold. */
const MAX_FACTORIAL = 170;
/** Trig results this close to zero are rounding noise (sin π, cos 90°). */
const TRIG_EPSILON = 1e-12;

const CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  π: Math.PI,
  e: Math.E,
};
const FUNCTION_NAMES = ["sin", "cos", "tan", "asin", "acos", "atan", "ln", "log", "sqrt"] as const;
type FunctionName = (typeof FUNCTION_NAMES)[number];
const ALIASES: Readonly<Record<string, string>> = {
  "√": "sqrt",
  "×": "*",
  "÷": "/",
  "−": "-",
};

function tokenize(expression: string): Token[] {
  if (expression.length > MAX_LENGTH) throw new Error("Expression is too long.");
  const tokens: Token[] = [];
  let offset = 0;
  while (offset < expression.length) {
    const rest = expression.slice(offset);
    const space = /^\s+/.exec(rest);
    if (space) {
      offset += space[0].length;
      continue;
    }
    const numeric = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
    if (numeric) {
      const value = Number(numeric[0]);
      if (!Number.isFinite(value)) throw new Error("Number is too large.");
      tokens.push({ kind: "number", value });
      offset += numeric[0].length;
      continue;
    }
    const word = /^(?:[a-zA-Z]+|π)/.exec(rest);
    if (word) {
      tokens.push({ kind: "name", value: word[0].toLowerCase() });
      offset += word[0].length;
      continue;
    }
    const character = expression[offset++]!;
    const symbol = ALIASES[character] ?? character;
    if (symbol === "sqrt") tokens.push({ kind: "name", value: symbol });
    else if ("+-*/%^()!".includes(symbol)) tokens.push({ kind: "operator", value: symbol });
    else throw new Error(`Unexpected character '${character}'.`);
  }
  return [...tokens, { kind: "end" }];
}

const isFunction = (name: string): name is FunctionName =>
  (FUNCTION_NAMES as readonly string[]).includes(name);

function trig(value: number): number {
  return Math.abs(value) < TRIG_EPSILON ? 0 : value;
}

function apply(name: FunctionName, x: number, angle: AngleUnit): number {
  const toRadians = angle === "degrees" ? Math.PI / 180 : 1;
  switch (name) {
    case "sin":
      return trig(Math.sin(x * toRadians));
    case "cos":
      return trig(Math.cos(x * toRadians));
    case "tan": {
      // An odd multiple of 90° has no tangent; floating point would return ±1.6e16 instead.
      if (trig(Math.cos(x * toRadians)) === 0) throw new Error("tan is undefined at that angle.");
      return trig(Math.tan(x * toRadians));
    }
    case "asin":
    case "acos": {
      if (x < -1 || x > 1) throw new Error(`${name} needs a value between -1 and 1.`);
      return (name === "asin" ? Math.asin(x) : Math.acos(x)) / toRadians;
    }
    case "atan":
      return Math.atan(x) / toRadians;
    case "ln":
    case "log": {
      if (x <= 0) throw new Error(`${name} needs a positive value.`);
      return name === "ln" ? Math.log(x) : Math.log10(x);
    }
    case "sqrt": {
      if (x < 0) throw new Error("√ needs a value of zero or more.");
      return Math.sqrt(x);
    }
  }
}

function factorial(value: number): number {
  if (!Number.isInteger(value) || value < 0)
    throw new Error("! needs a whole number of zero or more.");
  if (value > MAX_FACTORIAL) throw new Error("Result is outside the supported number range.");
  let result = 1;
  for (let factor = 2; factor <= value; factor++) result *= factor;
  return result;
}

/** Round to 12 significant digits so 0.1+0.2 reads 0.3, as people expect from a calculator. */
function formatNumber(value: number): string {
  return Number.parseFloat(value.toPrecision(12)).toString();
}

export function calculate(expression: string, options: CalculateOptions = {}): Calculation {
  const angle = options.angle ?? "radians";
  const tokens = tokenize(expression);
  let index = 0;
  const peek = (): Token => tokens[index] ?? { kind: "end" };
  const operator = (value: string): boolean => {
    const token = peek();
    return token.kind === "operator" && token.value === value;
  };
  const expect = (value: string, message: string) => {
    if (!operator(value)) throw new Error(message);
    index++;
  };
  const primary = (): number => {
    const token = peek();
    if (token.kind === "number") {
      index++;
      return token.value;
    }
    if (token.kind === "name") {
      index++;
      const constant = CONSTANTS[token.value];
      if (constant !== undefined) return constant;
      if (!isFunction(token.value)) throw new Error(`Unknown name '${token.value}'.`);
      expect("(", `Put ${token.value === "sqrt" ? "√" : token.value}'s value in parentheses.`);
      const argument = sum();
      expect(")", "Close the parenthesis.");
      return apply(token.value, argument, angle);
    }
    if (operator("(")) {
      index++;
      const value = sum();
      expect(")", "Close the parenthesis.");
      return value;
    }
    throw new Error("Expected a number or parenthesis.");
  };
  const postfix = (): number => {
    let value = primary();
    while (operator("!")) {
      index++;
      value = factorial(value);
    }
    return value;
  };
  const power = (): number => {
    const left = postfix();
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
    for (;;) {
      const token = peek();
      if (token.kind !== "operator" || !"*/%".includes(token.value)) return value;
      index++;
      const right = unary();
      if (token.value !== "*" && right === 0) throw new Error("Cannot divide by zero.");
      value =
        token.value === "*" ? value * right : token.value === "/" ? value / right : value % right;
    }
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
  // Normalise -0 so a result never reads "-0".
  const clean = value === 0 ? 0 : value;
  return { expression, value: clean, formatted: formatNumber(clean) };
}
