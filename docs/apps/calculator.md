# Calculator

`@moire/calculator` accepts typed expressions or keypad input. Its launcher entry
is `moire-calculator.desktop`, command `moire-calculator`, and app ID
`org.moire.Calculator`.

Enter in the expression field or the `=` keypad button calculates. Enter and
Space activate the focused keypad, Clear or history control. Escape and Clear
clear the expression and result.
Select a recent calculation to reuse its expression. Up to 50 results remain
for the current window session.

## Arithmetic reference

The parser supports decimal and exponent-form numbers, unary signs, parentheses,
`+`, `-`, `*` or `×`, `/` or `÷`, `^` for power, and `%` for remainder. Powers
associate right to left and run before unary minus: `2^3^2` is 512 and `-2^2` is
-4. Multiplication, division, and remainder run before addition and subtraction.

The app parses tokens directly and never uses `eval`. Missing operators,
unclosed parentheses, unknown characters, division by zero, and non-finite
results produce a visible error. Results use JavaScript floating-point numbers
and display up to 12 significant digits. Expressions are limited to 2,048
characters. There are no symbolic calculations or stored financial precision.

Run `pnpm --filter @moire/calculator smoke` for parser precedence and rejection
cases plus actual Window typing, Enter, and Clear input.
