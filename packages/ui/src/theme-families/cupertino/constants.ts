import type { ButtonSize, ButtonVariant, IconButtonVariant } from "#ui/widget-theme";

export const CUPERTINO_SIZES: readonly ButtonSize[] = ["small", "medium", "large"];
export const CUPERTINO_BUTTON_VARIANTS: readonly ButtonVariant[] = [
  "primary",
  "secondary",
  "ghost",
  "danger",
];
export const CUPERTINO_ICON_VARIANTS: readonly IconButtonVariant[] = [
  "standard",
  "ghost",
  "danger",
];

export const CUPERTINO_CONTROL_HEIGHTS: Record<ButtonSize, number> = {
  small: 24,
  medium: 28,
  large: 34,
};

export const CUPERTINO_CONTROL_RADII: Record<ButtonSize, number> = {
  small: 6,
  medium: 7,
  large: 9,
};
