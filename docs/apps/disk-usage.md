# Disk Usage

Enter a folder path and Scan. The explorer sorts entries by allocated space;
open a directory row to inspect its contents and use Up to return. Search
filters the current folder. Cancel stops the scan.

Allocated space uses filesystem block counts; logical size counts file bytes.
Hardlinks count once. Symlinks and other filesystems are not traversed. Scans
stop at 100,000 entries or depth 128 and explicitly report partial results and
skipped entries. The app does not delete files or scan automatically.

Command: `moire-disk-usage [folder]`. Package: `@moire/disk-usage`.

Run `pnpm --filter @moire/disk-usage smoke` for disposable filesystem accounting,
cancellation, limits and real app drill-down. Live desktop acceptance is pending.
