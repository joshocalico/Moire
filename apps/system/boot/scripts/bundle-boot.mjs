import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Build only. The installed entries run Node directly, without tsx/esbuild.
const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(process.argv[2] ?? path.join(here, "../../../.."));
const destination = process.argv[3];
if (!destination || !path.isAbsolute(destination))
  throw new Error("Pass workspace root and an absolute fresh output directory");
if (fs.existsSync(destination)) throw new Error("Boot bundle output must be a fresh directory");
const fromWorkspace = createRequire(path.join(workspace, "package.json"));
const fromTsx = createRequire(
  fromWorkspace.resolve("tsx", { paths: [path.join(workspace, "apps/system/compositor")] }),
);
const { build } = fromTsx("esbuild");
const source = path.join(workspace, "apps/system/boot/src");
const cliGuard = "path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)";
const shims = {
  guardian: `import {runBootGuardian} from ${JSON.stringify(path.join(source, "main.ts"))};
try { const result=await runBootGuardian(); if(result.kind==='failed') process.exitCode=1; else if(result.kind==='skipped') console.log('[boot] presentation skipped: '+result.reason); }
catch(error) {console.error('[boot]',error instanceof Error?error.message:error);process.exitCode=1;}`,
  renderer: `import {runBootRenderer} from ${JSON.stringify(path.join(source, "renderer.tsx"))}; await runBootRenderer();`,
  cleanup: `import {runBootCleanupCommand} from ${JSON.stringify(path.join(source, "cleanup.ts"))}; process.exitCode=await runBootCleanupCommand(process.argv.slice(2));`,
  "initial-startup": `import {runInitialStartupCommand} from ${JSON.stringify(path.join(source, "initial-startup.ts"))}; process.exitCode=await runInitialStartupCommand(process.argv.slice(2));`,
  "generate-assets": `import {generateBootArtwork} from ${JSON.stringify(path.join(source, "generate-assets.ts"))};
if(!process.argv[2]) throw new Error('Pass the boot Fold RGBA destination');generateBootArtwork(process.argv[2]);`,
};
const transformed = [];
const entryPoints = {
  ...Object.fromEntries(Object.keys(shims).map((name) => [name, `boot-entry:${name}`])),
  "guardian-smoke": path.join(source, "guardian.smoke.ts"),
  "view-smoke": path.join(source, "view.smoke.tsx"),
  "managed-guardian-smoke": path.join(source, "managed-guardian.smoke.ts"),
  "service-cleanup-smoke": path.join(workspace, "packages/sys/src/boot-service-cleanup.smoke.ts"),
  "renderer-lifetime-smoke": path.join(source, "renderer-lifetime.smoke.ts"),
  "renderer-lifetime-child": path.join(source, "renderer-lifetime.child.ts"),
  "release-admission-smoke": path.join(
    workspace,
    "packages/sys/src/boot-release-admission.smoke.ts",
  ),
  "manager-observation-smoke": path.join(
    workspace,
    "packages/sys/src/boot-manager-observation.smoke.ts",
  ),
  "cleanup-cli-smoke": path.join(source, "cleanup.smoke.ts"),
  "initial-startup-smoke": path.join(source, "initial-startup.smoke.ts"),
  "console-latch-smoke": path.join(source, "console-latch.smoke.ts"),
  "desktop-admission-smoke": path.join(source, "desktop-admission.smoke.ts"),
  "renderer-environment-smoke": path.join(source, "renderer-environment.smoke.ts"),
  "systemd-notify-smoke": path.join(workspace, "packages/sys/src/systemd-notify.smoke.ts"),
};
const result = await build({
  absWorkingDir: workspace,
  entryPoints,
  bundle: true,
  splitting: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outdir: destination,
  entryNames: "src/entry/[name]",
  chunkNames: "src/entry/chunk-[hash]",
  outExtension: { ".js": ".mjs" },
  external: ["koffi", "yoga-layout"],
  metafile: true,
  sourcemap: false,
  banner: {
    js: 'import { createRequire as bootCreateRequire } from "node:module"; const require = bootCreateRequire(import.meta.url);',
  },
  plugins: [
    {
      name: "boot-entry-and-assets",
      setup(plugin) {
        plugin.onResolve({ filter: /^boot-entry:/ }, (args) => ({
          path: args.path.slice("boot-entry:".length),
          namespace: "boot-entry",
        }));
        plugin.onLoad({ filter: /.*/, namespace: "boot-entry" }, (args) => ({
          contents: shims[args.path],
          loader: "js",
          resolveDir: workspace,
        }));
        plugin.onLoad({ filter: /\.[jt]sx?$/ }, async (args) => {
          const relative = path.relative(workspace, args.path).split(path.sep).join("/");
          const replacements = new Map([
            [
              "packages/theme/src/index.ts",
              ['"../../../themes/default/theme.json"', '"../../themes/default/theme.json"'],
            ],
            ["packages/prefs/src/apply.ts", ['"../../../themes"', '"../../themes"']],
          ]);
          const importedCli = [
            "apps/system/boot/src/main.ts",
            "apps/system/boot/src/renderer.tsx",
            "apps/system/boot/src/generate-assets.ts",
            "apps/system/boot/src/cleanup.ts",
            "apps/system/boot/src/initial-startup.ts",
          ].includes(relative);
          const replacement = replacements.get(relative);
          if (!importedCli && !replacement) return;
          let contents = await fs.promises.readFile(args.path, "utf8");
          if (importedCli) {
            if (!contents.includes(cliGuard))
              throw new Error(`Unrecognized CLI guard in ${relative}`);
            // Explicit entry shims own execution. Imported generator helpers in a
            // shared chunk must not execute because import.meta.url was bundled.
            contents = contents.replace(cliGuard, "false");
          }
          if (replacement) {
            if (!contents.includes(replacement[0]))
              throw new Error(`Unrecognized asset lookup in ${relative}`);
            contents = contents.replace(replacement[0], replacement[1]);
          }
          transformed.push(relative);
          return {
            contents,
            loader: relative.endsWith("tsx") ? "tsx" : "ts",
            resolveDir: path.dirname(args.path),
          };
        });
      },
    },
  ],
});

const files = [];
function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files.push(path.relative(destination, to));
}
for (const filename of fs.readdirSync(path.join(workspace, "packages/ui/fonts"))) {
  copyFile(
    path.join(workspace, "packages/ui/fonts", filename),
    path.join(destination, "fonts", filename),
  );
}
for (const filename of fs.readdirSync(path.join(workspace, "packages/ui/icons"))) {
  if (filename.endsWith(".svg"))
    copyFile(
      path.join(workspace, "packages/ui/icons", filename),
      path.join(destination, "icons", filename),
    );
}
copyFile(
  path.join(workspace, "themes/default/theme.json"),
  path.join(destination, "themes/default/theme.json"),
);

// Yoga embeds its WASM in dist/binaries/yoga-wasm-base64-esm.js. Keep that
// module beside its loader, not a guessed standalone .wasm filename.
const yogaEntry = fromWorkspace.resolve("yoga-layout", {
  paths: [path.join(workspace, "packages/ui")],
});
const yoga = path.resolve(path.dirname(yogaEntry), "../..");
fs.mkdirSync(path.join(destination, "node_modules/yoga-layout"), { recursive: true });
fs.cpSync(path.join(yoga, "dist"), path.join(destination, "node_modules/yoga-layout/dist"), {
  recursive: true,
});
copyFile(
  path.join(yoga, "package.json"),
  path.join(destination, "node_modules/yoga-layout/package.json"),
);
if (fs.existsSync(path.join(yoga, "LICENSE")))
  copyFile(path.join(yoga, "LICENSE"), path.join(destination, "node_modules/yoga-layout/LICENSE"));

const koffi = path.dirname(
  fromWorkspace.resolve("koffi", { paths: [path.join(workspace, "packages/sys")] }),
);
const triplet = `${process.platform}_${process.arch}`;
copyFile(path.join(koffi, "index.js"), path.join(destination, "node_modules/koffi/index.js"));
copyFile(
  path.join(koffi, "package.json"),
  path.join(destination, "node_modules/koffi/package.json"),
);
copyFile(
  path.join(koffi, "build/koffi", triplet, "koffi.node"),
  path.join(destination, "node_modules/koffi/build/koffi", triplet, "koffi.node"),
);
for (const filename of ["LICENSE", "LICENSE.txt"])
  if (fs.existsSync(path.join(koffi, filename)))
    copyFile(path.join(koffi, filename), path.join(destination, "node_modules/koffi", filename));

// No absolute workspace/store input paths in installed metadata: those would
// falsely retain the full desktop package as a runtime Nix reference.
const inputs = Object.entries(result.metafile.inputs).map(([name, info]) => ({
  name,
  bytes: info.bytes,
}));
const outputs = Object.entries(result.metafile.outputs).map(([name, info]) => ({
  name: path.relative(destination, path.resolve(workspace, name)),
  bytes: info.bytes,
}));
for (const name of Object.keys(entryPoints)) {
  if (!outputs.some((output) => output.name === `src/entry/${name}.mjs`))
    throw new Error(`Declared entry did not produce an artifact: ${name}`);
}
const manifest = {
  format: 1,
  nodeTarget: "node22",
  nativeTriplet: triplet,
  entries: Object.keys(entryPoints),
  transformed: transformed.sort(),
  inputs,
  outputs,
  assets: files.sort(),
  wasm: "node_modules/yoga-layout/dist/binaries/yoga-wasm-base64-esm.js",
  scope: "precompiled static boot stage; native recovery/animation gates unfinished",
};
for (const input of inputs)
  if (path.isAbsolute(input.name))
    throw new Error(`Absolute build input leaked into metadata: ${input.name}`);
fs.writeFileSync(
  path.join(destination, "bundle-manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    bundle: destination,
    entries: manifest.entries,
    nativeTriplet: triplet,
    assets: files.length,
    javascriptBytes: outputs.reduce((sum, file) => sum + file.bytes, 0),
    manifestSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
  }),
);
