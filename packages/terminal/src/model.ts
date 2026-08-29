export type TerminalCell = {
  char: string;
  foreground: number;
  background: number;
  bold: boolean;
};

export type TerminalSnapshot = {
  columns: number;
  rows: number;
  lines: readonly (readonly TerminalCell[])[];
  cursorLine: number;
  cursorColumn: number;
  cursorVisible: boolean;
  title: string;
};

type Pen = {
  foreground: number;
  background: number;
  bold: boolean;
  inverse: boolean;
};

type ParserState = "text" | "escape" | "csi" | "osc" | "oscEscape" | "charset";

export const TERMINAL_DEFAULT_FOREGROUND = 0xffd7e1e8;
export const TERMINAL_DEFAULT_BACKGROUND = 0xff101419;
const ANSI = [
  0xff1b2027, 0xffd35f5f, 0xff70b77e, 0xffd1ae55, 0xff639ad6, 0xffaa7ac1, 0xff58b9c6, 0xffd7e1e8,
  0xff66727d, 0xffff7b72, 0xff8fd694, 0xffffd166, 0xff82b7ef, 0xffcf8fe3, 0xff73d2de, 0xffffffff,
] as const;

function blankCell(): TerminalCell {
  return {
    char: " ",
    foreground: TERMINAL_DEFAULT_FOREGROUND,
    background: TERMINAL_DEFAULT_BACKGROUND,
    bold: false,
  };
}

function blankLine(columns: number): TerminalCell[] {
  return Array.from({ length: columns }, blankCell);
}

function cloneLine(line: readonly TerminalCell[], columns: number): TerminalCell[] {
  const next = Array.from({ length: columns }, (_, index) => ({
    ...(line[index] ?? blankCell()),
  }));
  return next;
}

function indexedColor(index: number): number {
  const value = Math.max(0, Math.min(255, Math.floor(index)));
  if (value < 16) return ANSI[value] ?? TERMINAL_DEFAULT_FOREGROUND;
  if (value >= 232) {
    const gray = 8 + (value - 232) * 10;
    return (0xff000000 | (gray << 16) | (gray << 8) | gray) >>> 0;
  }
  const cube = value - 16;
  const red = Math.floor(cube / 36);
  const green = Math.floor((cube % 36) / 6);
  const blue = cube % 6;
  const channel = (part: number) => (part === 0 ? 0 : 55 + part * 40);
  return (0xff000000 | (channel(red) << 16) | (channel(green) << 8) | channel(blue)) >>> 0;
}

/** Renderer-independent VT-style screen and scrollback model. */
export class TerminalBuffer {
  private columnsValue: number;
  private rowsValue: number;
  private screen: TerminalCell[][];
  private scrollback: TerminalCell[][] = [];
  private cursorRow = 0;
  private cursorColumn = 0;
  private savedCursor = { row: 0, column: 0 };
  private cursorVisibleValue = true;
  private titleValue = "Terminal";
  private pen: Pen = {
    foreground: TERMINAL_DEFAULT_FOREGROUND,
    background: TERMINAL_DEFAULT_BACKGROUND,
    bold: false,
    inverse: false,
  };
  private parserState: ParserState = "text";
  private parserBuffer = "";
  private responses: string[] = [];
  private alternate: { screen: TerminalCell[][]; row: number; column: number } | undefined;

  constructor(
    columns = 80,
    rows = 24,
    private readonly scrollbackLimit = 5000,
  ) {
    this.columnsValue = Math.max(2, Math.floor(columns));
    this.rowsValue = Math.max(1, Math.floor(rows));
    this.screen = Array.from({ length: this.rowsValue }, () => blankLine(this.columnsValue));
  }

  get columns(): number {
    return this.columnsValue;
  }

  get rows(): number {
    return this.rowsValue;
  }

  write(chunk: string): void {
    for (const char of chunk) this.consume(char);
  }

  resize(columns: number, rows: number): void {
    const nextColumns = Math.max(2, Math.floor(columns));
    const nextRows = Math.max(1, Math.floor(rows));
    if (nextColumns !== this.columnsValue) {
      this.screen = this.screen.map((line) => cloneLine(line, nextColumns));
      this.scrollback = this.scrollback.map((line) => cloneLine(line, nextColumns));
      this.columnsValue = nextColumns;
      this.cursorColumn = Math.min(this.cursorColumn, nextColumns - 1);
    }
    if (nextRows < this.rowsValue) {
      const remove = this.rowsValue - nextRows;
      const moved = this.screen.splice(0, remove);
      if (!this.alternate) this.pushScrollback(...moved);
      this.cursorRow = Math.max(0, this.cursorRow - remove);
    } else if (nextRows > this.rowsValue) {
      this.screen.push(
        ...Array.from({ length: nextRows - this.rowsValue }, () => blankLine(this.columnsValue)),
      );
    }
    this.rowsValue = nextRows;
    this.cursorRow = Math.min(this.cursorRow, nextRows - 1);
  }

  snapshot(): TerminalSnapshot {
    const lines = [...this.scrollback, ...this.screen].map((line) => {
      let end = line.length;
      while (end > 0 && line[end - 1]?.char === " ") end--;
      return line.slice(0, end).map((cell) => ({ ...cell }));
    });
    return {
      columns: this.columnsValue,
      rows: this.rowsValue,
      lines,
      cursorLine: this.scrollback.length + this.cursorRow,
      cursorColumn: this.cursorColumn,
      cursorVisible: this.cursorVisibleValue,
      title: this.titleValue,
    };
  }

  drainResponses(): string[] {
    const responses = this.responses;
    this.responses = [];
    return responses;
  }

  private consume(char: string): void {
    if (this.parserState === "text") {
      if (char === "\x1b") this.parserState = "escape";
      else this.writeCharacter(char);
      return;
    }
    if (this.parserState === "escape") {
      if (char === "[") {
        this.parserState = "csi";
        this.parserBuffer = "";
      } else if (char === "]") {
        this.parserState = "osc";
        this.parserBuffer = "";
      } else if (char === "7") {
        this.saveCursor();
        this.parserState = "text";
      } else if (char === "8") {
        this.restoreCursor();
        this.parserState = "text";
      } else if (char === "c") {
        this.reset();
        this.parserState = "text";
      } else if (char === "(" || char === ")") {
        this.parserState = "charset";
      } else {
        this.parserState = "text";
      }
      return;
    }
    if (this.parserState === "charset") {
      this.parserState = "text";
      return;
    }
    if (this.parserState === "csi") {
      if (char >= "@" && char <= "~") {
        this.handleCsi(this.parserBuffer, char);
        this.parserBuffer = "";
        this.parserState = "text";
      } else {
        this.parserBuffer += char;
      }
      return;
    }
    if (this.parserState === "osc") {
      if (char === "\u0007") {
        this.handleOsc(this.parserBuffer);
        this.parserBuffer = "";
        this.parserState = "text";
      } else if (char === "\x1b") {
        this.parserState = "oscEscape";
      } else {
        this.parserBuffer += char;
      }
      return;
    }
    if (char === "\\") {
      this.handleOsc(this.parserBuffer);
      this.parserBuffer = "";
      this.parserState = "text";
    } else {
      this.parserBuffer += `\x1b${char}`;
      this.parserState = "osc";
    }
  }

  private writeCharacter(char: string): void {
    if (char === "\u0000" || char === "\u0007") return;
    if (char === "\r") {
      this.cursorColumn = 0;
      return;
    }
    if (char === "\n" || char === "\u000b" || char === "\u000c") {
      this.lineFeed();
      return;
    }
    if (char === "\b") {
      this.cursorColumn = Math.max(0, this.cursorColumn - 1);
      return;
    }
    if (char === "\t") {
      this.cursorColumn = Math.min(
        this.columnsValue - 1,
        (Math.floor(this.cursorColumn / 8) + 1) * 8,
      );
      return;
    }
    if (char < " ") return;
    if (this.cursorColumn >= this.columnsValue) {
      this.cursorColumn = 0;
      this.lineFeed();
    }
    const foreground = this.pen.inverse ? this.pen.background : this.pen.foreground;
    const background = this.pen.inverse ? this.pen.foreground : this.pen.background;
    const line = this.screen[this.cursorRow];
    if (line) {
      line[this.cursorColumn] = {
        char,
        foreground,
        background,
        bold: this.pen.bold,
      };
    }
    this.cursorColumn++;
  }

  private lineFeed(): void {
    this.cursorRow++;
    if (this.cursorRow < this.rowsValue) return;
    const first = this.screen.shift();
    if (first && !this.alternate) this.pushScrollback(first);
    this.screen.push(blankLine(this.columnsValue));
    this.cursorRow = this.rowsValue - 1;
  }

  private pushScrollback(...lines: TerminalCell[][]): void {
    this.scrollback.push(...lines);
    if (this.scrollback.length > this.scrollbackLimit) {
      this.scrollback.splice(0, this.scrollback.length - this.scrollbackLimit);
    }
  }

  private handleCsi(raw: string, final: string): void {
    const privateMode = raw.startsWith("?");
    const body = privateMode ? raw.slice(1) : raw;
    const parameters =
      body.length === 0 ? [0] : body.split(";").map((value) => Number.parseInt(value || "0", 10));
    const value = (index: number, fallback = 1) => {
      const current = parameters[index] ?? 0;
      return current === 0 ? fallback : current;
    };
    if (privateMode && (final === "h" || final === "l")) {
      const enabled = final === "h";
      for (const parameter of parameters) {
        if (parameter === 25) this.cursorVisibleValue = enabled;
        if (parameter === 1049) this.setAlternateScreen(enabled);
      }
      return;
    }
    if (final === "A") this.cursorRow = Math.max(0, this.cursorRow - value(0));
    else if (final === "B")
      this.cursorRow = Math.min(this.rowsValue - 1, this.cursorRow + value(0));
    else if (final === "C")
      this.cursorColumn = Math.min(this.columnsValue - 1, this.cursorColumn + value(0));
    else if (final === "D") this.cursorColumn = Math.max(0, this.cursorColumn - value(0));
    else if (final === "E") {
      this.cursorRow = Math.min(this.rowsValue - 1, this.cursorRow + value(0));
      this.cursorColumn = 0;
    } else if (final === "F") {
      this.cursorRow = Math.max(0, this.cursorRow - value(0));
      this.cursorColumn = 0;
    } else if (final === "G") this.cursorColumn = Math.min(this.columnsValue - 1, value(0) - 1);
    else if (final === "H" || final === "f") {
      this.cursorRow = Math.min(this.rowsValue - 1, value(0) - 1);
      this.cursorColumn = Math.min(this.columnsValue - 1, value(1) - 1);
    } else if (final === "d") this.cursorRow = Math.min(this.rowsValue - 1, value(0) - 1);
    else if (final === "J") this.eraseDisplay(parameters[0] ?? 0);
    else if (final === "K") this.eraseLine(parameters[0] ?? 0);
    else if (final === "m") this.setGraphics(parameters);
    else if (final === "s") this.saveCursor();
    else if (final === "u") this.restoreCursor();
    else if (final === "P") this.deleteCharacters(value(0));
    else if (final === "@") this.insertCharacters(value(0));
    else if (final === "X") this.eraseCharacters(value(0));
    else if (final === "S") this.scrollUp(value(0));
    else if (final === "T") this.scrollDown(value(0));
    else if (final === "n" && parameters[0] === 6) {
      this.responses.push(`\x1b[${this.cursorRow + 1};${this.cursorColumn + 1}R`);
    } else if (final === "c") {
      this.responses.push("\x1b[?1;2c");
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.screen = Array.from({ length: this.rowsValue }, () => blankLine(this.columnsValue));
      if (mode === 3) this.scrollback = [];
      return;
    }
    if (mode === 0) {
      this.eraseLine(0);
      for (let row = this.cursorRow + 1; row < this.rowsValue; row++) {
        this.screen[row] = blankLine(this.columnsValue);
      }
    } else if (mode === 1) {
      this.eraseLine(1);
      for (let row = 0; row < this.cursorRow; row++) {
        this.screen[row] = blankLine(this.columnsValue);
      }
    }
  }

  private eraseLine(mode: number): void {
    const line = this.screen[this.cursorRow];
    if (!line) return;
    const start = mode === 0 ? this.cursorColumn : 0;
    const end = mode === 1 ? this.cursorColumn + 1 : this.columnsValue;
    for (let column = start; column < end; column++) line[column] = blankCell();
  }

  private eraseCharacters(count: number): void {
    const line = this.screen[this.cursorRow];
    if (!line) return;
    const end = Math.min(this.columnsValue, this.cursorColumn + count);
    for (let column = this.cursorColumn; column < end; column++) line[column] = blankCell();
  }

  private deleteCharacters(count: number): void {
    const line = this.screen[this.cursorRow];
    if (!line) return;
    line.splice(this.cursorColumn, count);
    while (line.length < this.columnsValue) line.push(blankCell());
  }

  private insertCharacters(count: number): void {
    const line = this.screen[this.cursorRow];
    if (!line) return;
    line.splice(this.cursorColumn, 0, ...Array.from({ length: count }, blankCell));
    line.length = this.columnsValue;
  }

  private scrollUp(count: number): void {
    for (let index = 0; index < count; index++) {
      const first = this.screen.shift();
      if (first && !this.alternate) this.pushScrollback(first);
      this.screen.push(blankLine(this.columnsValue));
    }
  }

  private scrollDown(count: number): void {
    for (let index = 0; index < count; index++) {
      this.screen.pop();
      this.screen.unshift(blankLine(this.columnsValue));
    }
  }

  private setGraphics(parameters: number[]): void {
    if (parameters.length === 0) parameters = [0];
    for (let index = 0; index < parameters.length; index++) {
      const code = parameters[index] ?? 0;
      if (code === 0) {
        this.pen = {
          foreground: TERMINAL_DEFAULT_FOREGROUND,
          background: TERMINAL_DEFAULT_BACKGROUND,
          bold: false,
          inverse: false,
        };
      } else if (code === 1) this.pen.bold = true;
      else if (code === 22) this.pen.bold = false;
      else if (code === 7) this.pen.inverse = true;
      else if (code === 27) this.pen.inverse = false;
      else if (code >= 30 && code <= 37)
        this.pen.foreground = ANSI[code - 30] ?? TERMINAL_DEFAULT_FOREGROUND;
      else if (code >= 90 && code <= 97)
        this.pen.foreground = ANSI[code - 90 + 8] ?? TERMINAL_DEFAULT_FOREGROUND;
      else if (code === 39) this.pen.foreground = TERMINAL_DEFAULT_FOREGROUND;
      else if (code >= 40 && code <= 47)
        this.pen.background = ANSI[code - 40] ?? TERMINAL_DEFAULT_BACKGROUND;
      else if (code >= 100 && code <= 107)
        this.pen.background = ANSI[code - 100 + 8] ?? TERMINAL_DEFAULT_BACKGROUND;
      else if (code === 49) this.pen.background = TERMINAL_DEFAULT_BACKGROUND;
      else if ((code === 38 || code === 48) && parameters[index + 1] === 5) {
        const color = indexedColor(parameters[index + 2] ?? 0);
        if (code === 38) this.pen.foreground = color;
        else this.pen.background = color;
        index += 2;
      } else if ((code === 38 || code === 48) && parameters[index + 1] === 2) {
        const red = Math.max(0, Math.min(255, parameters[index + 2] ?? 0));
        const green = Math.max(0, Math.min(255, parameters[index + 3] ?? 0));
        const blue = Math.max(0, Math.min(255, parameters[index + 4] ?? 0));
        const color = (0xff000000 | (red << 16) | (green << 8) | blue) >>> 0;
        if (code === 38) this.pen.foreground = color;
        else this.pen.background = color;
        index += 4;
      }
    }
  }

  private saveCursor(): void {
    this.savedCursor = { row: this.cursorRow, column: this.cursorColumn };
  }

  private restoreCursor(): void {
    this.cursorRow = Math.min(this.rowsValue - 1, this.savedCursor.row);
    this.cursorColumn = Math.min(this.columnsValue - 1, this.savedCursor.column);
  }

  private setAlternateScreen(enabled: boolean): void {
    if (enabled && !this.alternate) {
      this.alternate = {
        screen: this.screen,
        row: this.cursorRow,
        column: this.cursorColumn,
      };
      this.screen = Array.from({ length: this.rowsValue }, () => blankLine(this.columnsValue));
      this.cursorRow = 0;
      this.cursorColumn = 0;
    } else if (!enabled && this.alternate) {
      this.screen = this.alternate.screen.map((line) => cloneLine(line, this.columnsValue));
      this.cursorRow = Math.min(this.rowsValue - 1, this.alternate.row);
      this.cursorColumn = Math.min(this.columnsValue - 1, this.alternate.column);
      this.alternate = undefined;
    }
  }

  private handleOsc(payload: string): void {
    const separator = payload.indexOf(";");
    if (separator < 0) return;
    const command = payload.slice(0, separator);
    if (command === "0" || command === "2") {
      this.titleValue = payload.slice(separator + 1) || "Terminal";
    }
  }

  private reset(): void {
    this.screen = Array.from({ length: this.rowsValue }, () => blankLine(this.columnsValue));
    this.scrollback = [];
    this.cursorRow = 0;
    this.cursorColumn = 0;
    this.cursorVisibleValue = true;
    this.pen = {
      foreground: TERMINAL_DEFAULT_FOREGROUND,
      background: TERMINAL_DEFAULT_BACKGROUND,
      bold: false,
      inverse: false,
    };
  }
}
