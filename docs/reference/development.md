# Development conventions

Moire keeps package boundaries explicit so apps and packages can move without turning a refactor into a path-repair exercise.

## Imports

- Use the extensionless `./module` form for a module in the same directory.
- Do not use parent-relative imports (`../module.js`, `../../module.js`, and so on).
- Use the workspace package name when crossing a package boundary, such as `@moire/ui` or `@moire/sys`.
- For a deeper import inside one package, use a package-private import map. `@moire/ui`, for example, maps extensionless `#ui/*` specifiers to its own `src/*` tree.
- Extend `@moire/tsconfig/base.json`; do not calculate a path back to a root config.

Oxlint enforces the source-import rules with `import/no-relative-parent-imports`. Same-directory imports remain deliberately available.

## Native code

Koffi is an implementation detail of `@moire/sys`. Apps and other packages import typed operations from `@moire/sys`; they do not load a native library or declare a C function themselves.

Inside `@moire/sys`, new low-level bindings use the private `bindNativeFunction<Signature>()` adapter so every call has checked argument and result types. The public ABI is made only from narrower operating-system capabilities such as `createPipe`, `createMemfd`, `mmap`, `nativeView`, or `ioctlFd`. This keeps the FFI implementation replaceable without pushing its function or pointer types into the rest of Moire.

## Checks

```bash
pnpm lint
pnpm format:check
pnpm typecheck
```

Use `pnpm format` to apply the canonical Oxfmt style.
