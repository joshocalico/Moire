/** Reproduce app-label clipping and prose allocation through real widgets/input. */
import assert from "node:assert/strict";
import React from "react";
import {
  Group,
  Rect,
  SoftwareRenderer,
  collectHits,
  createShellRoot,
  renderShell,
  type SceneNode,
} from "@moire/react-host";
import { THEME_FAMILIES } from "@moire/theme";
import {
  Button,
  Column,
  ContentCard,
  Label,
  ScrollColumn,
  Row,
  TextBlock,
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  measureWrappedText,
  setUiScaleFactor,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";

const allNodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(allNodes)];
const texts = (node: SceneNode): SceneNode[] =>
  allNodes(node).filter((child) => child.kind === "text");
function absolute(node: SceneNode): { x: number; y: number } {
  let x = 0,
    y = 0;
  for (let current: SceneNode | null = node; current; current = current.parent) {
    x +=
      current.x +
      (typeof current.translateX === "number"
        ? current.translateX
        : (current.translateX?.get() ?? 0));
    y +=
      current.y +
      (typeof current.translateY === "number"
        ? current.translateY
        : (current.translateY?.get() ?? 0));
  }
  return { x, y };
}
const artwork = (style: { size: number; color: number }) => (
  <Rect width={style.size} height={style.size} fill={style.color} />
);
await installUiFonts();
const renderer = new SoftwareRenderer();
let buttonCases = 0,
  paragraphCases = 0,
  keyboardCases = 0,
  flowCases = 0;
try {
  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const) {
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", { themeFamily: family, colorScheme, reducedMotion: true }),
      );
      for (const scale of [1, 1.5]) {
        setUiScaleFactor(scale);
        const context = `${family}/${colorScheme}/scale${scale}`;
        const root = createShellRoot();
        renderShell(
          root,
          <WidgetThemeProvider theme={theme}>
            <Group width={1020} height={300}>
              <Row width={1020} height={70} padding={12} gap={10}>
                {[
                  ["New note", 82],
                  ["Open", 60],
                  ["Save As…", 82],
                  ["Close", 56],
                  ["Look up", 82],
                ].map(([label, minimum]) => (
                  <Button
                    key={label}
                    label={String(label)}
                    minWidth={Number(minimum) * scale}
                    focusId={`app:${label}`}
                    onPress={() => {}}
                  />
                ))}
              </Row>
              <Button x={12} y={90} label="Open" focusId="plain" onPress={() => {}} />
              <Button
                x={160}
                y={90}
                label="Open"
                leadingIcon={artwork}
                focusId="leading"
                onPress={() => {}}
              />
              <Button
                x={340}
                y={90}
                label="Open"
                leadingIcon={artwork}
                trailingIcon={artwork}
                focusId="both"
                onPress={() => {}}
              />
              <Button
                x={12}
                y={170}
                label="Wide minimum"
                minWidth={280}
                focusId="minimum"
                onPress={() => {}}
              />
              <Button
                x={340}
                y={170}
                label="Explicit"
                width={100}
                minWidth={280}
                focusId="explicit"
                onPress={() => {}}
              />
            </Group>
          </WidgetThemeProvider>,
        );
        const hits = collectHits(root.container);
        for (const label of ["New note", "Open", "Save As…", "Close", "Look up"]) {
          assert.ok(
            texts(root.container).some((node) => node.text === label),
            `${context}: app action label ${label} was clipped`,
          );
          const hit = hits.find((item) => item.focusId === `app:${label}`);
          assert.ok(hit && hit.width > 0, `${context}: natural app button has no hit region`);
          assert.ok(
            hit.x >= 0 && hit.x + hit.width <= 1020,
            `${context}: natural Row allocation exceeds viewport`,
          );
        }
        const plain = hits.find((hit) => hit.focusId === "plain"),
          leading = hits.find((hit) => hit.focusId === "leading"),
          both = hits.find((hit) => hit.focusId === "both");
        assert.ok(plain && leading && both);
        assert.ok(
          plain.width < leading.width && leading.width < both.width,
          `${context}: artwork did not participate in intrinsic width`,
        );
        assert.ok(
          hits.find((hit) => hit.focusId === "minimum")!.width >= 280,
          `${context}: standalone minWidth was ignored`,
        );
        assert.equal(
          hits.find((hit) => hit.focusId === "explicit")!.width,
          100,
          `${context}: explicit width must remain authoritative`,
        );
        assert.ok(
          renderer
            .render(root.container, { width: 1020, height: 300 })
            .pixels.some((pixel) => pixel !== 0),
        );
        renderShell(root, null);
        buttonCases++;

        for (const width of [64, 137, 320])
          for (const source of [
            "A definition has useful context.\nIts example belongs on a separate line.",
            "First paragraph\n\nThird paragraph\n",
            "Averylongunbrokentokenmustflowwithoutlosingcharacters",
            "éééééééééééééééééééé",
            "  Words   with   repeated spaces  ",
            "",
          ]) {
            const style = { fontSize: 14, lineGap: 3 * scale };
            const measured = measureWrappedText(source, width, style);
            const proseRoot = createShellRoot();
            renderShell(
              proseRoot,
              <WidgetThemeProvider theme={theme}>
                <TextBlock
                  width={width}
                  height={measured.height}
                  text={source}
                  wrap
                  overflow="clip"
                  {...style}
                />
              </WidgetThemeProvider>,
            );
            const actual = texts(proseRoot.container);
            assert.deepEqual(
              actual.map((node) => node.text ?? ""),
              measured.lines,
              `${context}/${width}: public wrapping differs from painted lines`,
            );
            for (const [index, node] of actual.entries()) {
              assert.equal(
                absolute(node).y,
                index * (measured.lineHeight + style.lineGap),
                `${context}: painted line spacing differs from public measurement`,
              );
            }
            // Empty paragraphs have no painted glyph rectangle but still reserve
            // a line box. Include that final line box in the measured extent.
            const bottom = absolute(actual.at(-1)!).y + measured.lineHeight;
            assert.ok(
              Math.abs(bottom - measured.height) < 0.001,
              `${context}/${width}: measured height ${measured.height} differs from painted bottom ${bottom}`,
            );
            if (!source.includes(" ") && !source.includes("\n"))
              assert.equal(
                actual.map((node) => node.text).join(""),
                source,
                `${context}: long-word wrapping lost characters`,
              );
            if (source.includes("\n\n"))
              assert.ok(
                actual.some((node) => node.text === ""),
                `${context}: paragraph whitespace was lost`,
              );
            if (source.endsWith("\n"))
              assert.equal(actual.at(-1)?.text, "", `${context}: trailing paragraph line was lost`);
            renderShell(proseRoot, null);
            paragraphCases++;
          }

        // An explicit numeric card key must not collide with a neighboring
        // unkeyed heading when layout introduces provider wrappers.
        const keyedRoot = createShellRoot();
        const keyWarnings: string[] = [];
        const originalError = console.error;
        console.error = (...args: unknown[]) => {
          keyWarnings.push(args.map(String).join(" "));
        };
        try {
          for (const suffix of ["before", "after"]) {
            renderShell(
              keyedRoot,
              <WidgetThemeProvider theme={theme}>
                <Column width={320}>
                  <Label text={`Unkeyed heading ${suffix}`} wrap />
                  <ContentCard key={0} padding={8}>
                    <Label text={`Numeric keyed card ${suffix}`} wrap />
                  </ContentCard>
                </Column>
              </WidgetThemeProvider>,
            );
            assert.deepEqual(
              texts(keyedRoot.container).map((node) => node.text),
              [`Unkeyed heading ${suffix}`, `Numeric keyed card ${suffix}`],
              `${context}: keyed and unkeyed flow children lost identity`,
            );
          }
          assert.deepEqual(
            keyWarnings,
            [],
            `${context}: layout wrappers emitted React key warnings`,
          );
        } finally {
          console.error = originalError;
          renderShell(keyedRoot, null);
        }

        // App prose must be able to change length and viewport width without
        // allocating any child height or maintaining a separate scroll extent.
        const flowRoot = createShellRoot();
        let flowWidth = 420,
          scrollY = 0,
          narrative = "A short definition.";
        const flowHeight = 150 * scale;
        const showFlow = () =>
          renderShell(
            flowRoot,
            <WidgetThemeProvider theme={theme}>
              <ScrollColumn
                x={12}
                y={12}
                width={flowWidth}
                height={flowHeight}
                gap={12 * scale}
                smooth={false}
                scrollY={scrollY}
                onScroll={(next) => {
                  scrollY = next;
                }}
              >
                <ContentCard padding={8 * scale} gap={8 * scale}>
                  <Label text="Definition" fontSize={16} wrap />
                  <Column gap={6 * scale}>
                    <Label text={narrative} fontSize={14} wrap />
                    <ContentCard padding={6 * scale} gap={4 * scale}>
                      <Label text="Example" fontSize={12} wrap />
                      <Label
                        text="An example remains attached to its definition.\nAverylongunbrokentokenmustflowwithoutlosingcharacters"
                        fontSize={14}
                        wrap
                      />
                    </ContentCard>
                  </Column>
                </ContentCard>
                <ContentCard padding={8 * scale}>
                  <Label text="Following card" fontSize={14} wrap />
                </ContentCard>
              </ScrollColumn>
            </WidgetThemeProvider>,
          );
        const extents: number[] = [];
        for (const long of [false, true]) {
          narrative = long
            ? "A definition carries enough context to explain an idea without clipping its final sentence. ".repeat(
                8,
              ) + "\n\nThe next paragraph should remain separate."
            : "A short definition.";
          for (const width of [420, 200]) {
            flowWidth = width;
            scrollY = 0;
            showFlow();
            const nodes = texts(flowRoot.container);
            const following = nodes.find((node) => node.text === "Following card")!;
            assert.ok(following, `${context}: following card vanished`);
            const firstY = absolute(following).y;
            const before = nodes.slice(0, nodes.indexOf(following));
            const previousBottom = Math.max(
              ...before.map((node) => absolute(node).y + node.height),
            );
            assert.ok(
              firstY >= previousBottom,
              `${context}/${width}: natural nested card overlaps preceding prose`,
            );
            for (const node of nodes) {
              const point = absolute(node);
              assert.ok(
                point.x >= 12 && point.x + node.width <= 12 + width + 0.01,
                `${context}/${width}: nested width inference clips ${node.text}`,
              );
            }
            // Compare actual nested line flow with public measurement, taking
            // the allocated Label's width directly from its host group.
            const proseGroup = nodes[1]!.parent!;
            const measuredProse = measureWrappedText(narrative, proseGroup.width, { fontSize: 14 });
            assert.deepEqual(
              proseGroup.children
                .filter((node) => node.kind === "text")
                .map((node) => node.text ?? ""),
              measuredProse.lines,
              `${context}/${width}: nested prose diverges from its allocated width`,
            );
            assert.ok(
              Math.abs(proseGroup.height - measuredProse.height) < 0.01,
              `${context}/${width}: nested prose line boxes were not naturally allocated`,
            );
            const wheel = collectHits(flowRoot.container).find(
              (hit) => hit.onWheel && hit.width === width,
            );
            assert.ok(wheel?.onWheel, `${context}/${width}: natural overflow has no wheel target`);
            wheel.onWheel({ x: 20, y: 20, localX: 8, localY: 8, deltaY: 100000 });
            assert.ok(scrollY > 0, `${context}/${width}: natural extent did not scroll`);
            const extent = scrollY;
            showFlow();
            const moved = texts(flowRoot.container).find((node) => node.text === "Following card")!;
            const movedY = absolute(moved).y;
            assert.ok(
              Math.abs(firstY - movedY - extent) < 0.01,
              `${context}/${width}: controlled scroll did not move actual content`,
            );
            assert.ok(
              movedY >= 12 && movedY + moved.height <= 12 + flowHeight + 0.01,
              `${context}/${width}: final card cannot be reached at scroll end`,
            );
            assert.ok(
              collectHits(flowRoot.container).filter((hit) => hit.onWheel).length >= 2,
              `${context}/${width}: overflowing flow lost its scrollbar`,
            );
            assert.ok(
              renderer
                .render(flowRoot.container, { width: 460, height: Math.ceil(flowHeight + 24) })
                .pixels.some((pixel) => pixel !== 0),
            );
            extents.push(extent);
            flowCases++;
          }
        }
        assert.ok(
          extents[1]! > extents[0]!,
          `${context}: narrowing nested prose did not increase extent`,
        );
        assert.ok(
          extents[2]! > extents[0]! && extents[3]! > extents[1]!,
          `${context}: changing text length did not recompute natural extent`,
        );
        renderShell(flowRoot, null);

        const backend = new HeadlessPlatform();
        await backend.connect();
        const window = new Window({ title: "Intrinsic button keyboard", width: 940, height: 120 });
        const activated: string[] = [];
        window.setContent(
          <WidgetThemeProvider theme={theme}>
            <Row x={12} y={12} width={916} height={70} gap={12}>
              <Button
                label="Open folder"
                leadingIcon={artwork}
                autoFocus
                onPress={(event) => {
                  assert.ok(
                    event && event.localX > 0 && event.localY > 0,
                    "keyboard activation lost target bounds",
                  );
                  activated.push("open");
                }}
              />
              <Button label="Disabled" disabled onPress={() => activated.push("disabled")} />
              <Button
                label="Save As…"
                trailingIcon={artwork}
                minWidth={120 * scale}
                onPress={() => activated.push("save")}
              />
            </Row>
          </WidgetThemeProvider>,
        );
        try {
          window.mount(backend);
          await Promise.resolve();
          window.tick();
          const native = backend.getWindows()[0]!;
          let timeMs = 0;
          const inject = (code: number, key: string, repeat = false) => {
            const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
            native.injectKey({
              type: repeat ? "repeat" : "down",
              code,
              key,
              modifiers,
              timeMs: ++timeMs,
            });
            if (!repeat) native.injectKey({ type: "up", code, key, modifiers, timeMs: ++timeMs });
            window.tick();
          };
          inject(28, "Enter");
          inject(28, "Enter", true);
          inject(57, " ");
          assert.deepEqual(
            activated,
            ["open", "open"],
            `${context}: Enter/Space or repeat activation failed`,
          );
          inject(15, "Tab");
          inject(28, "Enter");
          assert.deepEqual(
            activated,
            ["open", "open", "save"],
            `${context}: Tab did not skip the disabled button`,
          );
          assert.ok(
            native.lastFrame?.some((pixel) => pixel !== 0),
            `${context}: actual keyboard Window did not render`,
          );
          keyboardCases++;
        } finally {
          window.destroy();
          backend.disconnect();
        }
      }
    }
  console.log(
    `[ui/intrinsic-content] ${buttonCases} theme/scale button layouts, ${paragraphCases} actual paragraph layouts and ${keyboardCases} native Window keyboard flows and ${flowCases} nested-card resize/scroll layouts passed`,
  );
} finally {
  setUiScaleFactor(1);
}
