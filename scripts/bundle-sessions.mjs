// Build only: precompile installed session entries (greeter pre-login, desktop
// compositor) so the graphical stages start with plain `node <bundle>.mjs`
// instead of transpiling ~160 TypeScript modules through tsx on every boot.
//
// usage: node scripts/bundle-sessions.mjs <workspace> <fresh-absolute-outdir> <name>=<entry>...
//
// The bundle is not relocatable: it runs from inside the installed workspace.
// Every `import.meta.url` (workspace sources and dependencies alike) is pinned
// to that module's installed file, so fonts, icons, themes, prefs, precomputed pixels and
// createRequire() lookups (x11) resolve exactly as they do under tsx. Native
// addons stay external and are imported by absolute installed path.
import fs from "node:fs";
import path from "node:path";
import { builtinModules, createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const [workspaceArg, destination, ...entryArgs] = process.argv.slice(2);
if (!workspaceArg || !destination || !path.isAbsolute(destination) || entryArgs.length === 0)
  throw new Error(
    "Pass the workspace root, an absolute fresh output directory and name=entry pairs",
  );
const workspace = fs.realpathSync(path.resolve(workspaceArg));
if (fs.existsSync(destination)) throw new Error("Session bundle output must be a fresh directory");
const entryPoints = {};
for (const arg of entryArgs) {
  const separator = arg.indexOf("=");
  const name = arg.slice(0, separator);
  if (separator < 1 || !/^[a-z][a-z0-9-]*$/.test(name) || Object.hasOwn(entryPoints, name))
    throw new Error(`Invalid entry declaration: ${arg}`);
  const entry = path.resolve(workspace, arg.slice(separator + 1));
  if (!fs.statSync(entry).isFile()) throw new Error(`Entry is not a file: ${entry}`);
  entryPoints[name] = entry;
}

const fromWorkspace = createRequire(path.join(workspace, "package.json"));
const fromTsx = createRequire(
  fromWorkspace.resolve("tsx", { paths: [path.join(workspace, "apps/system/compositor")] }),
);
const { build } = fromTsx("esbuild");

// Native addons must load from their installed package at runtime.
const nativePackages = ["koffi"];
const loaders = {
  ".ts": "ts",
  ".mts": "ts",
  ".cts": "ts",
  ".tsx": "tsx",
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".jsx": "jsx",
};
const pinned = [];

const result = await build({
  absWorkingDir: workspace,
  entryPoints,
  bundle: true,
  splitting: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: destination,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  outExtension: { ".js": ".mjs" },
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  sourcemap: "linked",
  sourcesContent: false,
  logLevel: "warning",
  banner: {
    js: 'import { createRequire as moireSessionCreateRequire } from "node:module"; const require = moireSessionCreateRequire(import.meta.url);',
  },
  plugins: [
    {
      name: "moire-session-runtime",
      setup(plugin) {
        const nativeFilter = new RegExp(`^(?:${nativePackages.join("|")})$`);
        plugin.onResolve({ filter: nativeFilter }, (args) => ({
          path: createRequire(args.importer || path.join(workspace, "package.json")).resolve(
            args.path,
          ),
          external: true,
        }));
        plugin.onResolve({ filter: /\.node$/ }, (args) => {
          throw new Error(`Unexpected native addon import ${args.path} from ${args.importer}`);
        });
        plugin.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
          if (!args.path.startsWith(workspace + path.sep)) return undefined;
          const source = await fs.promises.readFile(args.path, "utf8");
          if (!source.includes("import.meta.url")) return undefined;
          pinned.push(path.relative(workspace, args.path).split(path.sep).join("/"));
          return {
            contents: source.replaceAll(
              "import.meta.url",
              JSON.stringify(pathToFileURL(args.path).href),
            ),
            loader: loaders[path.extname(args.path)],
            resolveDir: path.dirname(args.path),
          };
        });
      },
    },
  ],
});

const outputs = Object.entries(result.metafile.outputs).map(([name, info]) => ({
  name: path.relative(destination, path.resolve(workspace, name)),
  bytes: info.bytes,
}));
for (const name of Object.keys(entryPoints))
  if (!outputs.some((output) => output.name === `${name}.mjs`))
    throw new Error(`Declared entry did not produce an artifact: ${name}`);
const externals = new Set();
for (const output of Object.values(result.metafile.outputs))
  for (const imported of output.imports)
    if (
      imported.external &&
      !imported.path.startsWith("node:") &&
      !builtinModules.includes(imported.path)
    )
      externals.add(imported.path);
for (const external of externals) {
  if (!path.isAbsolute(external) || !fs.existsSync(external))
    throw new Error(`Unresolved external import left in the session bundle: ${external}`);
}
// Only the createRequire banner may still read the bundle's own URL.
for (const output of outputs.filter((file) => file.name.endsWith(".mjs"))) {
  const code = fs.readFileSync(path.join(destination, output.name), "utf8");
  if (code.split("import.meta.url").length - 1 !== 1)
    throw new Error(`Unpinned import.meta.url left in ${output.name}`);
}

const manifest = {
  format: 1,
  nodeTarget: "node22",
  nodeEnv: "production",
  entries: Object.fromEntries(
    Object.entries(entryPoints).map(([name, entry]) => [name, path.relative(workspace, entry)]),
  ),
  externals: [...externals].map((external) => path.relative(workspace, external)).sort(),
  pinnedImportMetaUrl: pinned.sort(),
  inputs: Object.keys(result.metafile.inputs).length,
  outputs,
};
fs.writeFileSync(
  path.join(destination, "bundle-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    bundle: destination,
    entries: Object.keys(entryPoints),
    inputs: manifest.inputs,
    javascriptBytes: outputs
      .filter((file) => file.name.endsWith(".mjs"))
      .reduce((sum, file) => sum + file.bytes, 0),
  }),
);
