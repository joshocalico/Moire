/** Search input assembled from the shared editable-control primitives. */
import React, { type ReactNode } from "react";
import { Icon } from "./icon.js";
import { IconButton } from "./icon-button.js";
import { TextField, type TextFieldProps } from "./text-field.js";
import { registerIntrinsicSize } from "./layout.js";

export type SearchFieldProps = Omit<
  TextFieldProps,
  "leading" | "trailing"
> & {
  onClear?: () => void;
};

export function SearchField(props: SearchFieldProps): ReactNode {
  const { onClear, ...fieldProps } = props;
  const canClear = props.value.length > 0 && !props.disabled && !props.readOnly;

  return (
    <TextField
      {...fieldProps}
      leading={(style) => (
        <Icon name="search" size={style.size} color={style.color} />
      )}
      trailing={
        canClear
          ? (style) => (
              <IconButton
                width={style.size}
                height={style.size}
                size="small"
                variant="ghost"
                icon={(iconStyle) => (
                  <Icon
                    name="close"
                    size={Math.min(style.size, iconStyle.size)}
                    color={style.color}
                  />
                )}
                onPress={() => {
                  props.onChange?.("");
                  onClear?.();
                }}
              />
            )
          : undefined
      }
    />
  );
}

registerIntrinsicSize(SearchField, (props, theme) => ({
  width: props.width,
  height: props.height ?? theme.recipes.textField[props.size ?? "medium"].metrics.height,
}));
