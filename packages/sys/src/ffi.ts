import type { IKoffiLib, KoffiFunc } from "koffi";

/** A native integer whose width can exceed JavaScript's safe integer range. */
export type NativeInteger = number | bigint;

/**
 * A Koffi function with an explicit TypeScript call signature.
 *
 * Koffi intentionally returns an untyped variadic function from `lib.func()`.
 * All Moire bindings should pass through this helper so argument and return
 * types are checked at every call site.
 */
export type NativeFunction<Args extends unknown[], Result> = KoffiFunc<(...args: Args) => Result>;

export function bindNativeFunction<Fn extends (...args: never[]) => unknown>(
  library: IKoffiLib,
  declaration: string,
): KoffiFunc<Fn> {
  return library.func(declaration) as KoffiFunc<Fn>;
}
