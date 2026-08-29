import { isLinux, listDrmConnectors } from "./index";

async function main() {
  if (!isLinux()) {
    console.log(
      "Moire DRM probe: skipping on non-Linux (run inside the Ubuntu VM — docs/dev-vm.md).",
    );
    process.exit(0);
  }

  const connectors = listDrmConnectors();
  if (connectors.length === 0) {
    console.error("No DRM connectors found.");
    process.exit(1);
  }

  console.log("Moire DRM probe (koffi → libdrm):\n");
  for (const c of connectors) {
    const modePreview = c.modes.slice(0, 3).join(", ");
    const more = c.modes.length > 3 ? ` (+${c.modes.length - 3} more)` : "";
    console.log(`  ${c.cardPath}  connector ${c.connectorId}  ${c.connectorType}  ${c.connection}`);
    if (modePreview) {
      console.log(`    modes: ${modePreview}${more}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
