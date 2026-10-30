import { playbackSmoke } from "@moire/app-tools/testing";

// Sequential: each workflow swaps HOME/XDG for its own fixture.
await import("./model.smoke");
await import("./workflow.smoke");
await import("./library-ui.smoke");
await import("./default-window.smoke");
await playbackSmoke(false);
