/** Local design review only. Synthetic identities; no account discovery or PAM. */
import fs from "node:fs/promises";
import path from "node:path";
import React, { useMemo, useState, type ReactNode } from "react";
import { Rect } from "@moire/react-host";
import {
  Backdrop,
  BrandMark,
  Button,
  FocusScope,
  Icon,
  Label,
  MenuItem,
  OverlayHost,
  Popover,
  Pressable,
  Surface,
  TextField,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  createSilkBackdrop,
  discoverPersonalization,
  usePalette,
  useWidgetTheme,
} from "@moire/ui";
// oxlint-disable-next-line import/no-relative-parent-imports -- Actual Window capture harness.
import { greeterHarness } from "../testing";

const users = [
  { username: "alex", displayName: "Alex Morgan" },
  { username: "sam", displayName: "Sam Rivera" },
];
type DemoUser = (typeof users)[number];
function Avatar(props: { user: DemoUser; size: number; portrait: boolean }): ReactNode {
  const palette = usePalette(),
    size = props.size;
  return (
    <Surface width={size} height={size} radius={size / 2} fill={palette.accent} clip>
      {props.portrait ? (
        <>
          <Rect
            x={size * 0.34}
            y={size * 0.17}
            width={size * 0.32}
            height={size * 0.32}
            radius={size * 0.16}
            fill={0xffeeeaff}
          />
          <Rect
            x={size * 0.18}
            y={size * 0.54}
            width={size * 0.64}
            height={size * 0.45}
            radius={size * 0.3}
            fill={0xffeeeaff}
          />
        </>
      ) : (
        <Label
          width={size}
          height={size}
          text={props.user.displayName[0] ?? ""}
          horizontalAlign="center"
          verticalAlign="center"
          fontSize={size * 0.5}
          color={0xffffffff}
          fontWeight="medium"
        />
      )}
    </Surface>
  );
}
function Design(props: {
  width: number;
  height: number;
  portrait: boolean;
  password: boolean;
}): ReactNode {
  const palette = usePalette(),
    theme = useWidgetTheme();
  const center = props.width / 2;
  const [selected, setSelected] = useState<DemoUser | null>(
    props.password ? (users[0] ?? null) : null,
  );
  const [draft, setDraft] = useState("");
  const [desktopOpen, setDesktopOpen] = useState(false);
  const silk = useMemo(
    () =>
      createSilkBackdrop({
        variant: "greeter",
        palette: {
          background: palette.bg,
          filament: palette.accent,
          highlight: palette.muted,
        },
      }),
    [palette.bg, palette.accent, palette.muted],
  );
  const avatarTheme = useMemo(
    () => ({
      ...theme,
      recipes: {
        ...theme.recipes,
        button: {
          ...theme.recipes.button,
          ghost: {
            ...theme.recipes.button.ghost,
            medium: {
              ...theme.recipes.button.ghost.medium,
              root: {
                ...theme.recipes.button.ghost.medium.root,
                base: { ...theme.recipes.button.ghost.medium.root.base, radius: 52 },
              },
            },
          },
        },
      },
    }),
    [theme],
  );
  const menuTheme = useMemo(
    () => ({
      ...theme,
      recipes: {
        ...theme.recipes,
        menu: {
          ...theme.recipes.menu,
          medium: {
            ...theme.recipes.menu.medium,
            item: {
              ...theme.recipes.menu.medium.item,
              states: {
                ...theme.recipes.menu.medium.item.states,
                focused: { fill: palette.hover },
                selected: { fill: palette.hover },
              },
            },
          },
        },
      },
    }),
    [theme, palette.hover],
  );
  const desktopTheme = useMemo(
    () => ({
      ...theme,
      recipes: {
        ...theme.recipes,
        button: {
          ...theme.recipes.button,
          ghost: {
            ...theme.recipes.button.ghost,
            medium: {
              ...theme.recipes.button.ghost.medium,
              root: {
                ...theme.recipes.button.ghost.medium.root,
                states: {
                  ...theme.recipes.button.ghost.medium.root.states,
                  hover: { fill: 0 },
                  pressed: { fill: 0 },
                },
              },
            },
          },
        },
      },
    }),
    [theme],
  );
  const desktopY = selected ? 540 : 515;
  const changeUser = () => {
    setDraft("");
    setSelected(null);
    setDesktopOpen(false);
  };
  return (
    <Surface width={props.width} height={props.height} fill={palette.surface} clip>
      <Backdrop width={props.width} height={props.height} source={silk} reducedMotion />
      <OverlayHost width={props.width} height={props.height}>
        <FocusScope width={props.width} height={props.height} trap={false}>
          <BrandMark x={center - 56} y={128} width={112} height={36} />
          <Label
            x={props.width - 180}
            y={40}
            width={140}
            height={28}
            text="9:41 AM"
            horizontalAlign="end"
            fontSize={18}
            color={palette.muted}
          />
          {selected ? (
            <>
              <Surface x={center - 38} y={215} width={76} height={76} fill={0}>
                <Avatar user={selected} size={76} portrait={props.portrait} />
              </Surface>
              <Label
                x={center - 180}
                y={310}
                width={360}
                height={38}
                text={selected.displayName}
                horizontalAlign="center"
                fontSize={27}
                fontWeight="medium"
              />
              <Label
                x={center - 180}
                y={347}
                width={360}
                height={22}
                text={selected.username}
                horizontalAlign="center"
                fontSize={13}
                color={palette.muted}
              />
              <TextField
                x={center - 160}
                y={383}
                width={320}
                height={44}
                value={draft}
                password
                placeholder="Password"
                autoFocus
                onChange={setDraft}
                onCancel={changeUser}
              />
              <Button
                x={center - 160}
                y={441}
                width={320}
                height={42}
                label="Sign in"
                variant="primary"
                onPress={() => {}}
              />
              <Button
                x={center - 72}
                y={489}
                width={144}
                height={34}
                label="Change user"
                variant="ghost"
                onPress={changeUser}
                leadingIcon={(style) => (
                  <Icon name="back" size={style.size} color={style.color} symbolic />
                )}
              />
            </>
          ) : (
            <>
              <Label
                x={center - 240}
                y={230}
                width={480}
                height={42}
                text="Welcome to Moire"
                horizontalAlign="center"
                fontSize={28}
                fontWeight="medium"
              />
              <Label
                x={center - 240}
                y={277}
                width={480}
                height={24}
                text="Choose your account"
                horizontalAlign="center"
                fontSize={14}
                color={palette.muted}
              />
              {users.map((user, index) => (
                <Pressable
                  key={user.username}
                  x={center - 180 + index * 204}
                  y={315}
                  width={156}
                  height={160}
                  fill={0}
                  hoverFill={0}
                  pressedFill={0}
                  focusable={false}
                  onPress={() => setSelected(user)}
                >
                  <WidgetThemeProvider theme={avatarTheme}>
                    <Surface x={26} y={0} width={104} height={104} fill={0}>
                      <Button
                        width={104}
                        height={104}
                        label=""
                        variant="ghost"
                        autoFocus={index === 0}
                        focusId={`mock:user:${user.username}`}
                        onPress={() => setSelected(user)}
                      />
                      <Surface x={10} y={10} width={84} height={84} fill={0}>
                        <Avatar user={user} size={84} portrait={props.portrait} />
                      </Surface>
                    </Surface>
                  </WidgetThemeProvider>
                  <Label
                    y={117}
                    width={156}
                    height={25}
                    text={user.displayName}
                    horizontalAlign="center"
                    fontSize={17}
                    fontWeight="medium"
                  />
                  <Label
                    y={143}
                    width={156}
                    height={20}
                    text={user.username}
                    horizontalAlign="center"
                    fontSize={12}
                    color={palette.muted}
                  />
                </Pressable>
              ))}
            </>
          )}
          <WidgetThemeProvider theme={desktopTheme}>
            <Button
              x={center - 85}
              y={desktopY}
              width={170}
              height={34}
              label="Moire Wayland"
              variant="ghost"
              focusId="mock:desktop"
              onPress={() => setDesktopOpen(!desktopOpen)}
              trailingIcon={(style) => (
                <Icon
                  name={desktopOpen ? "chevron-up" : "chevron-down"}
                  size={style.size}
                  color={style.color}
                  symbolic
                />
              )}
            />
          </WidgetThemeProvider>
          <WidgetThemeProvider theme={menuTheme}>
            <Popover
              open={desktopOpen}
              viewportWidth={props.width}
              viewportHeight={props.height}
              anchor={{ x: center - 85, y: desktopY, width: 170, height: 34 }}
              width={220}
              height={92}
              modal={false}
              onDismiss={() => setDesktopOpen(false)}
            >
              <MenuItem
                x={5}
                y={5}
                width={210}
                height={40}
                label="Moire Wayland"
                autoFocus
                leading={
                  <Label width={18} height={22} text="✓" fontSize={17} color={palette.text} />
                }
                onPress={() => setDesktopOpen(false)}
              />
              <MenuItem x={5} y={47} width={210} height={40} label="Other desktop" disabled />
            </Popover>
          </WidgetThemeProvider>
          <Button
            x={props.width - 180}
            y={props.height - 58}
            width={140}
            height={40}
            label="Accessibility"
            variant="ghost"
            onPress={() => {}}
          />
        </FocusScope>
      </OverlayHost>
    </Surface>
  );
}

const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error("Pass a fresh absolute mock directory.");
await fs.mkdir(output);
const theme = createPersonalizedWidgetTheme(
  discoverPersonalization("linux", {
    source: "application",
    themeFamily: "moire",
    reducedMotion: true,
  }),
);
const captures: string[] = [];
for (const password of [false, true]) {
  const app = await greeterHarness((size) => (
    <WidgetThemeProvider theme={theme}>
      <Design {...size} portrait password={password} />
    </WidgetThemeProvider>
  ));
  try {
    await app.settle();
    if (password) {
      app.click(640, 557);
      await app.settle();
    }
    const file = path.join(output, password ? "password-desktop-flyout.png" : "picker-avatar.png");
    await app.capture(file, { width: 1280, height: 800 });
    captures.push(file);
  } finally {
    app.destroy();
  }
}
await fs.writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(
    {
      scope: "One centered design direction for Loop review only",
      syntheticUsers: true,
      optionalAvatarFallback: "same Avatar component renders initials when portrait=false",
      desktopChoices:
        "Other desktop is a disabled illustrative option; no installed catalog or launch",
      animation: "shared Silk still frame only; production wave unchanged",
      nativeAcceptance: false,
      uploaded: false,
      captures,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ captures, reviewOnly: true }));
