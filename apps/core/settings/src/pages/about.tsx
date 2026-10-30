/** About & Updates: what this computer is, how Moire is updated, and where to look when it fails. */
import { configDir } from "@moire/prefs";
import { formatBytes, showInFiles } from "@moire/app-tools";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { buttonRow, infoRow, section } from "#settings-view/rows";
import { systemReport } from "#settings/system-info";

const PAGE = "about";

export function aboutPage(context: PageContext): PageContent {
  const { system } = context;
  return {
    summary: `${system.hostname} · ${system.systemShort}`,
    sections: [
      section("about.system", "This computer", [
        infoRow("hostname", "Computer name", system.hostname),
        infoRow("system", "System", system.system),
        system.build ? infoRow("build", "Moire build", system.build) : null,
        system.generation != null
          ? infoRow(
              "generation",
              "System generation",
              String(system.generation),
              "The NixOS configuration this computer booted",
            )
          : null,
        infoRow("kernel", "Kernel", system.kernel),
        infoRow("memory", "Memory", formatBytes(system.memoryBytes)),
        system.processor
          ? infoRow("processor", "Processor", `${system.processor} × ${system.cores}`)
          : null,
        buttonRow("about.copy", "Copy", () =>
          context.attempt(PAGE, () =>
            context.copyText(systemReport(system, formatBytes)).then(() => null),
          ),
        ),
      ]),
      section("about.updates-section", "Updates", [
        {
          ...infoRow(
            "about.updates",
            "Updates",
            "No update source",
            "Moire is updated by installing a new system image",
          ),
        },
      ]),
      section("about.diagnostics", "Diagnostics", [
        {
          id: "diagnostics:processes",
          label: "Running apps",
          description: "Process Manager shows what's running and what it uses",
          chevron: true,
          onPress: () =>
            context.attempt(PAGE, () => context.launch("moire-process-manager").then(() => null)),
        },
        {
          id: "diagnostics:prefs",
          label: "Settings files",
          description: "Where Moire keeps your preferences",
          chevron: true,
          onPress: () => context.attempt(PAGE, () => showInFiles(configDir()).then(() => null)),
        },
      ]),
    ],
  };
}
