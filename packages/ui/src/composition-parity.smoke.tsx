/** Retained (GPU-path) composition matches the software reference: stacking, clips, shadows,
 * overlays and translucent groups, including fades driven through the presentation path. */
import assert from "node:assert/strict";
import React from "react";
import {
  Group,
  Rect,
  Text,
  createShellRoot,
  renderShell,
  SoftwareRenderer,
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
} from "@moire/react-host";
import {
  installUiFonts,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  OverlayHost,
  Popover,
  ScrollArea,
  Label,
  Button,
} from "./index";
await installUiFonts();
const theme = createPersonalizedWidgetTheme(
  discoverPersonalization("linux", { colorScheme: "dark", reducedMotion: true }),
);
const W = 360,
  H = 260;
const scenes: Record<string, () => React.ReactNode> = {
  siblings: () => (
    <Group width={W} height={H}>
      <Rect width={W} height={H} fill={0xff101018} />
      <Rect x={20} y={20} width={120} height={80} fill={0xffcc3344} />
      <Rect x={60} y={50} width={120} height={80} fill={0xff3344cc} />
      <Text x={70} y={60} text="over" color={0xffffffff} />
    </Group>
  ),
  textUnderRect: () => (
    <Group width={W} height={H}>
      <Rect width={W} height={H} fill={0xff101018} />
      <Text x={30} y={30} text="UNDER" color={0xffffffff} fontSize={30} />
      <Rect x={20} y={20} width={200} height={50} fill={0xff22aa66} />
    </Group>
  ),
  nestedClip: () => (
    <Group width={W} height={H}>
      <Rect width={W} height={H} fill={0xff101018} />
      <Group x={20} y={20} width={150} height={100} clip>
        <Rect width={300} height={300} fill={0xff8844aa} />
        <Group x={50} y={40} width={200} height={200} clip>
          <Rect width={400} height={400} fill={0xff44aa88} />
        </Group>
      </Group>
      <Rect x={100} y={60} width={100} height={100} fill={0xccaa8822} />
    </Group>
  ),
  nestedOpacity: () => (
    <Group width={W} height={H}>
      <Rect width={W} height={H} fill={0xff101018} />
      <Group opacity={0.7}>
        <Rect x={20} y={20} width={150} height={100} fill={0xffffffff} />
        <Group opacity={0.5}>
          <Rect x={60} y={50} width={150} height={100} fill={0xff00ff00} />
          <Text x={70} y={60} text="nested" color={0xffff00ff} />
        </Group>
      </Group>
    </Group>
  ),
  opacityClip: () => (
    <Group width={W} height={H}>
      <Rect width={W} height={H} fill={0xff101018} />
      <Group x={30} y={30} width={160} height={90} clip opacity={0.6}>
        <Rect width={200} height={200} fill={0xffffaa00} />
        <Rect x={40} y={20} width={200} height={200} fill={0xff0044ff} radius={10} />
      </Group>
    </Group>
  ),
  opacityShadow: () => (
    <Group width={W} height={H}>
      <Rect width={W} height={H} fill={0xffe0e0e8} />
      <Group opacity={0.55}>
        <Rect
          x={30}
          y={30}
          width={140}
          height={90}
          fill={0xff505060}
          radius={12}
          shadow={{ blurRadius: 16, offsetY: 6, color: 0xcc000000 }}
        />
        <Rect
          x={90}
          y={80}
          width={140}
          height={90}
          fill={0xff8888aa}
          radius={12}
          shadow={{ blurRadius: 16, offsetY: 6, color: 0xcc000000 }}
        />
      </Group>
    </Group>
  ),
  opacity: () => (
    <Group width={W} height={H}>
      <Rect width={W} height={H} fill={0xff101018} />
      <Group opacity={0.5}>
        <Rect x={20} y={20} width={150} height={100} fill={0xffffffff} />
        <Rect x={80} y={60} width={150} height={100} fill={0xffff0000} />
      </Group>
      <Rect x={140} y={40} width={60} height={160} fill={0xff0000ff} />
    </Group>
  ),
  shadows: () => (
    <Group width={W} height={H}>
      <Rect width={W} height={H} fill={0xff202028} />
      <Rect
        x={20}
        y={20}
        width={150}
        height={100}
        fill={0xff505060}
        radius={12}
        shadow={{ blurRadius: 18, offsetY: 8, color: 0xcc000000 }}
      />
      <Rect
        x={100}
        y={80}
        width={150}
        height={100}
        fill={0xff707080}
        radius={12}
        shadow={{ blurRadius: 18, offsetY: 8, color: 0xcc000000 }}
      />
    </Group>
  ),
  widgets: () => (
    <WidgetThemeProvider theme={theme}>
      <OverlayHost width={W} height={H}>
        <Rect width={W} height={H} fill={0xff101018} />
        <ScrollArea
          x={10}
          y={10}
          width={200}
          height={150}
          contentHeight={400}
          scrollY={30}
          smooth={false}
        >
          <Label x={10} y={10} width={160} height={20} text="Scrolled label" />
          <Button x={10} y={60} width={140} label="Button" />
        </ScrollArea>
        <Popover
          open
          viewportWidth={W}
          viewportHeight={H}
          anchor={{ x: 120, y: 60, width: 40, height: 20 }}
          width={180}
          height={120}
          onDismiss={() => {}}
        >
          <Label x={10} y={10} width={150} height={20} text="Popover" />
        </Popover>
        <Rect x={150} y={150} width={180} height={80} fill={0xff334455} />
      </OverlayHost>
    </WidgetThemeProvider>
  ),
};
let failures = 0;
const fade = {
  value: 1,
  get() {
    return this.value;
  },
};
scenes.liveFade = () => (
  <Group width={W} height={H}>
    <Rect width={W} height={H} fill={0xff101018} />
    <Group opacity={fade}>
      <Rect x={20} y={20} width={150} height={100} fill={0xffffffff} />
      <Rect x={80} y={60} width={150} height={100} fill={0xffff0000} />
    </Group>
  </Group>
);
for (const [name, scene] of Object.entries(scenes)) {
  const root = createShellRoot();
  renderShell(root, scene());
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 5));
    renderShell(root, scene());
  }
  const retainedRenderer = new RetainedSceneRenderer();
  let retained = retainedRenderer.render(root.container, { width: W, height: H });
  if (name === "liveFade") {
    // Animate the group's opacity without a React commit, as motion values do.
    for (const step of [0.8, 0.45]) {
      fade.value = step;
      retained =
        retainedRenderer.renderPresentation(root.container, { width: W, height: H }) ??
        retainedRenderer.render(root.container, { width: W, height: H });
    }
  }
  const sw = new SoftwareRenderer().render(root.container, { width: W, height: H }).pixels;
  const rt = new RetainedSoftwareRenderer().render(retained).pixels;
  let diff = 0,
    maxd = 0,
    first = -1;
  for (let i = 0; i < sw.length; i++) {
    const d = Math.abs(sw[i]! - rt[i]!);
    if (d > 24) {
      diff++;
      if (first < 0) first = i;
    }
    maxd = Math.max(maxd, d);
  }
  const px = first >= 0 ? `(${(first / 4) % W},${Math.floor(first / 4 / W)})` : "";
  console.log(`${name.padEnd(14)} differing channels ${diff} max ${maxd} ${px}`);
  if (diff > 0) failures++;
  renderShell(root, null);
}
assert.equal(failures, 0, "retained composition diverges from the software reference");
console.log(`[ui/composition-parity] ${Object.keys(scenes).length} scenes match`);
process.exit(0);
