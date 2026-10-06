# Archive Manager

Open an archive to inspect its entries. Enter a new folder path and Extract. For creation, enter one source path per line and a new .tar.gz output path, then Create. Cancel stops the running utility.

Compact windows place the destination field above Extract, Create and Cancel,
keeping every action visible at larger UI scales. Wider windows keep them in
one row.

Extract supports formats readable by libarchive, including ZIP and tar. Plain gzip streams also extract to a single file, with checksum validation and a 64 MiB decoded limit. Damaged or recognizable tar streams cannot fall back to plain-file extraction. Plain xz and bzip2 streams are unsupported. Creation uses tar.gz. Sources must have the same containing folder. Path traversal, absolute paths, duplicates, links and special entries are refused. Existing output paths are never replaced. Extraction stages privately and publishes the complete directory atomically without replacing a concurrently created destination. Cleanup removes only the app's private staging directory. Extracted directories keep owner write access so read-only archive directories can be published and cleaned up. Archives containing symlinks or hardlinks are currently unsupported.

Package: `apps/bundled/archive-manager`. Launcher: `moire-archive-manager`.
Required guest tools: bsdtar from libarchive and GNU mv with `--no-copy` and `--update=none` from the existing coreutils package. Host checks on macOS use `gmv`.

## Verification

```bash
pnpm --filter @moire/archive-manager smoke
pnpm --filter @moire/archive-manager typecheck
```

Real archive creation/list/extraction, original contents, existing destination preservation, traversal and symlink archives, cleanup on failures.

Tests write only disposable fixtures with isolated HOME/XDG directories.
Live focus, overlap, resize, keyboard and output-device acceptance remains open.

Archive listing and extraction run libarchive with a child-local UTF-8 locale,
so Unicode filenames remain intact even when the session locale is `C`.
Path validation still rejects escaped or unsafe archive members.
