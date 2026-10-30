/** Layout catalog from xkeyboard-config data files, and the built-in fallback. */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  FALLBACK_LAYOUTS,
  loadKeyboardLayoutCatalog,
  parseEvdevXml,
  parseRulesLst,
  xkbConfigRootCandidates,
} from "./keyboard-layouts";

const EVDEV_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xkbConfigRegistry SYSTEM "xkb.dtd">
<xkbConfigRegistry version="1.1">
  <modelList>
    <model><configItem><name>pc105</name><description>Generic 105-key PC</description></configItem></model>
  </modelList>
  <layoutList>
    <layout>
      <configItem>
        <name>us</name>
        <!-- Keyboard indicator for English layouts -->
        <shortDescription>en</shortDescription>
        <description>English (US)</description>
        <languageList><iso639Id>eng</iso639Id></languageList>
      </configItem>
      <variantList>
        <variant>
          <configItem>
            <name>intl</name>
            <description>English (US, intl., with dead keys)</description>
          </configItem>
        </variant>
        <variant>
          <configItem popularity="exotic">
            <name>chr</name>
            <shortDescription>chr</shortDescription>
            <description>Cherokee</description>
            <languageList><iso639Id>chr</iso639Id></languageList>
          </configItem>
        </variant>
      </variantList>
    </layout>
    <layout>
      <configItem>
        <name>de</name>
        <shortDescription>de</shortDescription>
        <_description>German</_description>
        <languageList><iso639Id>ger</iso639Id></languageList>
      </configItem>
      <variantList>
        <variant>
          <configItem>
            <name>nodeadkeys</name>
            <description>German (no dead keys)</description>
          </configItem>
        </variant>
      </variantList>
    </layout>
    <layout>
      <configItem>
        <name>ba</name>
        <shortDescription>bs</shortDescription>
        <description>Bosnian &amp; Herzegovinian &#x27;test&#39;</description>
      </configItem>
    </layout>
  </layoutList>
  <optionList>
    <group allowMultipleSelection="true">
      <configItem><name>grp</name><description>Switching to another layout</description></configItem>
      <option><configItem><name>grp:win_space_toggle</name><description>Win+Space</description></configItem></option>
    </group>
  </optionList>
</xkbConfigRegistry>
`;

const layouts = parseEvdevXml(EVDEV_XML);
assert.deepEqual(
  layouts.map((layout) => layout.name),
  ["ba", "us", "de"],
  "sorted by description; models and options ignored",
);
const us = layouts.find((layout) => layout.name === "us")!;
assert.deepEqual(us, {
  name: "us",
  description: "English (US)",
  shortDescription: "en",
  languages: ["eng"],
  variants: [
    { name: "chr", description: "Cherokee", shortDescription: "chr", languages: ["chr"] },
    {
      name: "intl",
      description: "English (US, intl., with dead keys)",
      shortDescription: "",
      languages: [],
    },
  ],
});
assert.equal(layouts.find((l) => l.name === "de")!.description, "German", "_description form");
assert.equal(layouts[0]!.description, "Bosnian & Herzegovinian 'test'", "entities decoded");
assert.deepEqual(layouts[0]!.variants, []);
console.log("PASS evdev.xml fixture parses layouts, variants, languages and entities");

const BASE_LST = `
! model
  pc105           Generic 105-key PC

! layout
  us              English (US)
  de              German

! variant
  intl            us: English (US, intl., with dead keys)
  nodeadkeys      de: German (no dead keys)
  orphan          zz: Unknown layout variant

! option
  grp                  Switching to another layout
`;
const lst = parseRulesLst(BASE_LST);
assert.deepEqual(
  lst.map((layout) => [layout.name, layout.variants.map((v) => v.name)]),
  [
    ["us", ["intl"]],
    ["de", ["nodeadkeys"]],
  ],
);
console.log("PASS base.lst fixture parses layouts and their variants");

const files = new Map([
  ["/missing/rules/evdev.xml", null],
  ["/broken/rules/evdev.xml", "<xkbConfigRegistry/>"],
  ["/broken/rules/base.lst", BASE_LST],
  ["/good/rules/evdev.xml", EVDEV_XML],
]);
const io = {
  exists: (file: string) => files.get(file) != null,
  read: (file: string) => files.get(file) ?? "",
};
assert.equal(loadKeyboardLayoutCatalog(["/good"], io).source, "evdev.xml");
const fromLst = loadKeyboardLayoutCatalog(["/missing", "/broken", "/good"], io);
assert.equal(fromLst.source, "lst", "an empty evdev.xml falls through to base.lst");
assert.equal(fromLst.path, "/broken/rules/base.lst");
const fallback = loadKeyboardLayoutCatalog(["/missing"], io);
assert.equal(fallback.source, "fallback");
assert.equal(fallback.layouts, FALLBACK_LAYOUTS);
assert.ok(
  FALLBACK_LAYOUTS.some((l) => l.name === "us" && l.variants.some((v) => v.name === "intl")),
);
assert.ok(
  FALLBACK_LAYOUTS.some((l) => l.name === "de" && l.variants.some((v) => v.name === "nodeadkeys")),
);
assert.deepEqual(
  xkbConfigRootCandidates({ MOIRE_XKB_CONFIG_ROOT: "/nix/store/x/share/X11/xkb" }).slice(0, 2),
  ["/nix/store/x/share/X11/xkb", "/run/current-system/sw/share/X11/xkb"],
);
console.log("PASS catalog search order: evdev.xml, .lst, then the built-in list");

// The real data, where present (Linux images; XQuartz on macOS). MOIRE_REQUIRE_XKB_DATA=1 in the
// nix install check turns a missing file into a failure rather than a skip.
const real = loadKeyboardLayoutCatalog();
if (real.source === "fallback") {
  assert.notEqual(process.env.MOIRE_REQUIRE_XKB_DATA, "1", "xkeyboard-config data must be found");
  console.log("SKIP no xkeyboard-config data on this host");
} else {
  assert.ok(real.path && fs.existsSync(real.path));
  assert.ok(real.layouts.length > 50, `real catalog has ${real.layouts.length} layouts`);
  const realUs = real.layouts.find((l) => l.name === "us");
  assert.ok(realUs && realUs.variants.some((v) => v.name === "intl"));
  assert.ok(
    real.layouts.find((l) => l.name === "de")?.variants.some((v) => v.name === "nodeadkeys"),
  );
  console.log(`PASS real catalog ${real.path}: ${real.layouts.length} layouts`);
}
