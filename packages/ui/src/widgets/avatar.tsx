/** A person in a circle: their picture, or initials on a colour picked from their name. */
import React, { type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { foregroundOn } from "#ui/theme-family-color";
import { ImageWidget } from "./image-widget";
import { registerIntrinsicSize } from "./layout";
import { Surface, TextBlock } from "./primitives";

export type AvatarProps = {
  x?: number;
  y?: number;
  /** The person's name; gives the initials and the colour. */
  name: string;
  /** A PNG picture; initials show until it loads, or when it can't. */
  image?: string | null;
  /** Diameter in unscaled pixels; 36 by default. */
  size?: number;
};

const COLORS = [0xffe8915a, 0xff8b7cf6, 0xff5aa2f0, 0xff3ecf8e, 0xffe86a9b, 0xff2fbfb3, 0xffe3b341];

/** Up to two initials: first and last word, or the first letter of a single name. */
export function avatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const first = Array.from(words[0]!)[0] ?? "";
  const last = words.length > 1 ? (Array.from(words.at(-1)!)[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** A stable colour for a name, so the same person always gets the same circle. */
export function avatarColor(name: string): number {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

export function Avatar(props: AvatarProps): ReactNode {
  const size = (props.size ?? 36) * getUiScaleFactor();
  const fill = avatarColor(props.name);
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={size} height={size}>
      <Surface width={size} height={size} radius={size / 2} fill={fill} clip>
        <TextBlock
          width={size}
          height={size}
          text={avatarInitials(props.name)}
          fontSize={Math.round((props.size ?? 36) * 0.38)}
          fontWeight="medium"
          color={foregroundOn(fill)}
          horizontalAlign="center"
          verticalAlign="center"
          maxLines={1}
        />
        {props.image ? (
          <ImageWidget
            width={size}
            height={size}
            src={props.image}
            fit="cover"
            placeholder={false}
          />
        ) : null}
      </Surface>
    </Group>
  );
}

registerIntrinsicSize(Avatar, (props) => ({
  width: (props.size ?? 36) * getUiScaleFactor(),
  height: (props.size ?? 36) * getUiScaleFactor(),
}));
