import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

export type SelectionState<Key> = {
  selectedKeys: ReadonlySet<Key>;
  anchorKey: Key | null;
  focusKey: Key | null;
};

export type SelectionGesture = {
  /** Ctrl/Command-style membership toggle. */
  toggle?: boolean;
  /** Shift-style inclusive range from the current anchor. */
  range?: boolean;
};

export type SelectionMoveOptions = {
  /** Extend an inclusive range from the current anchor. */
  extend?: boolean;
  /** Move focus without replacing the current selection. */
  preserveSelection?: boolean;
  wrap?: boolean;
};

export type SelectionOptions<Key> = {
  multiple?: boolean;
  allowEmpty?: boolean;
  initialSelectedKeys?: Iterable<Key>;
  initialFocusKey?: Key | null;
};

export type SelectionAction<Key> =
  | { type: "select"; key: Key; gesture?: SelectionGesture }
  | { type: "focus"; key: Key; select?: boolean }
  | { type: "move"; delta: number; options?: SelectionMoveOptions }
  | { type: "first"; options?: SelectionMoveOptions }
  | { type: "last"; options?: SelectionMoveOptions }
  | { type: "all" }
  | { type: "clear" };

export type SelectionModel<Key> = SelectionState<Key> & {
  selectedKeysInOrder: readonly Key[];
  primaryKey: Key | null;
  isSelected: (key: Key) => boolean;
  select: (key: Key, gesture?: SelectionGesture) => void;
  focus: (key: Key, select?: boolean) => void;
  move: (delta: number, options?: SelectionMoveOptions) => void;
  first: (options?: SelectionMoveOptions) => void;
  last: (options?: SelectionMoveOptions) => void;
  selectAll: () => void;
  clear: () => void;
};

function sameSet<Key>(left: ReadonlySet<Key>, right: ReadonlySet<Key>): boolean {
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}

function rangeSet<Key>(
  keys: readonly Key[],
  fromKey: Key,
  toKey: Key,
  initial?: ReadonlySet<Key>,
): Set<Key> {
  const from = keys.indexOf(fromKey);
  const to = keys.indexOf(toKey);
  const selected = new Set(initial);
  if (from < 0 || to < 0) return selected;
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  for (let index = start; index <= end; index++) {
    const key = keys[index];
    if (key !== undefined) selected.add(key);
  }
  return selected;
}

export function reconcileSelection<Key>(
  state: SelectionState<Key>,
  keys: readonly Key[],
  options: Pick<SelectionOptions<Key>, "allowEmpty"> = {},
): SelectionState<Key> {
  const available = new Set(keys);
  let selected = new Set(
    [...state.selectedKeys].filter((key) => available.has(key)),
  );
  let focusKey =
    state.focusKey !== null && available.has(state.focusKey)
      ? state.focusKey
      : null;
  let anchorKey =
    state.anchorKey !== null && available.has(state.anchorKey)
      ? state.anchorKey
      : null;

  if (selected.size === 0 && options.allowEmpty === false && keys.length > 0) {
    const fallback = focusKey ?? keys[0]!;
    selected = new Set([fallback]);
    focusKey = fallback;
    anchorKey = fallback;
  }
  if (focusKey === null && selected.size > 0) {
    focusKey = keys.find((key) => selected.has(key)) ?? null;
  }
  if (anchorKey === null && focusKey !== null) anchorKey = focusKey;

  if (
    sameSet(state.selectedKeys, selected) &&
    state.focusKey === focusKey &&
    state.anchorKey === anchorKey
  ) {
    return state;
  }
  return { selectedKeys: selected, focusKey, anchorKey };
}

export function createSelectionState<Key>(
  keys: readonly Key[],
  options: SelectionOptions<Key> = {},
): SelectionState<Key> {
  const initial = new Set(options.initialSelectedKeys);
  const firstSelected = keys.find((key) => initial.has(key)) ?? null;
  const focusKey = options.initialFocusKey ?? firstSelected;
  return reconcileSelection(
    {
      selectedKeys: initial,
      focusKey,
      anchorKey: focusKey,
    },
    keys,
    options,
  );
}

function movedIndex(
  current: number,
  delta: number,
  length: number,
  wrap: boolean,
): number {
  if (length <= 0) return -1;
  const raw = current < 0 ? (delta < 0 ? length - 1 : 0) : current + delta;
  if (wrap) return ((raw % length) + length) % length;
  return Math.max(0, Math.min(length - 1, raw));
}

function selectMovedKey<Key>(
  state: SelectionState<Key>,
  keys: readonly Key[],
  target: Key,
  options: SelectionMoveOptions,
  multiple: boolean,
): SelectionState<Key> {
  if (options.preserveSelection) {
    return { ...state, focusKey: target };
  }
  if (options.extend && multiple) {
    const anchor =
      state.anchorKey !== null && keys.includes(state.anchorKey)
        ? state.anchorKey
        : state.focusKey !== null && keys.includes(state.focusKey)
          ? state.focusKey
          : target;
    return {
      selectedKeys: rangeSet(keys, anchor, target),
      anchorKey: anchor,
      focusKey: target,
    };
  }
  return {
    selectedKeys: new Set([target]),
    anchorKey: target,
    focusKey: target,
  };
}

export function reduceSelection<Key>(
  state: SelectionState<Key>,
  keys: readonly Key[],
  action: SelectionAction<Key>,
  options: Pick<SelectionOptions<Key>, "multiple" | "allowEmpty"> = {},
): SelectionState<Key> {
  const current = reconcileSelection(state, keys, options);
  const multiple = options.multiple !== false;
  let next = current;

  if (action.type === "clear") {
    next = { selectedKeys: new Set(), anchorKey: null, focusKey: null };
  } else if (action.type === "all") {
    const selected = multiple ? new Set(keys) : new Set(keys.slice(0, 1));
    const focusKey =
      current.focusKey !== null && selected.has(current.focusKey)
        ? current.focusKey
        : keys[0] ?? null;
    next = { selectedKeys: selected, anchorKey: focusKey, focusKey };
  } else if (action.type === "focus") {
    if (!keys.includes(action.key)) return current;
    next = action.select === false
      ? { ...current, focusKey: action.key }
      : {
          selectedKeys: new Set([action.key]),
          anchorKey: action.key,
          focusKey: action.key,
        };
  } else if (action.type === "select") {
    if (!keys.includes(action.key)) return current;
    const gesture = action.gesture ?? {};
    if (gesture.range && multiple) {
      const anchor =
        current.anchorKey !== null && keys.includes(current.anchorKey)
          ? current.anchorKey
          : current.focusKey !== null && keys.includes(current.focusKey)
            ? current.focusKey
            : action.key;
      next = {
        selectedKeys: rangeSet(
          keys,
          anchor,
          action.key,
          gesture.toggle ? current.selectedKeys : undefined,
        ),
        anchorKey: anchor,
        focusKey: action.key,
      };
    } else if (gesture.toggle) {
      const selected = new Set(current.selectedKeys);
      if (selected.has(action.key)) selected.delete(action.key);
      else {
        if (!multiple) selected.clear();
        selected.add(action.key);
      }
      next = {
        selectedKeys: selected,
        anchorKey: action.key,
        focusKey: action.key,
      };
    } else {
      next = {
        selectedKeys: new Set([action.key]),
        anchorKey: action.key,
        focusKey: action.key,
      };
    }
  } else {
    if (keys.length === 0) return current;
    const moveOptions = action.options ?? {};
    let targetIndex: number;
    if (action.type === "first") targetIndex = 0;
    else if (action.type === "last") targetIndex = keys.length - 1;
    else {
      targetIndex = movedIndex(
        current.focusKey === null ? -1 : keys.indexOf(current.focusKey),
        action.delta,
        keys.length,
        moveOptions.wrap === true,
      );
    }
    const target = keys[targetIndex];
    if (target === undefined) return current;
    next = selectMovedKey(current, keys, target, moveOptions, multiple);
  }

  return reconcileSelection(next, keys, options);
}

/** React controller over the pure keyed selection reducer. */
export function useSelectionModel<Key>(
  keys: readonly Key[],
  options: SelectionOptions<Key> = {},
): SelectionModel<Key> {
  const multiple = options.multiple !== false;
  const allowEmpty = options.allowEmpty !== false;
  const [stored, setStored] = useState<SelectionState<Key>>(() =>
    createSelectionState(keys, options),
  );
  const state = reconcileSelection(stored, keys, { allowEmpty });

  useEffect(() => {
    if (state !== stored) setStored(state);
  }, [state, stored]);

  const dispatch = useCallback(
    (action: SelectionAction<Key>) => {
      setStored((current) =>
        reduceSelection(current, keys, action, { multiple, allowEmpty }),
      );
    },
    [allowEmpty, keys, multiple],
  );
  const selectedKeysInOrder = useMemo(
    () => keys.filter((key) => state.selectedKeys.has(key)),
    [keys, state.selectedKeys],
  );
  const primaryKey =
    state.focusKey !== null && state.selectedKeys.has(state.focusKey)
      ? state.focusKey
      : selectedKeysInOrder.at(-1) ?? null;

  return {
    ...state,
    selectedKeysInOrder,
    primaryKey,
    isSelected: (key) => state.selectedKeys.has(key),
    select: (key, gesture) => dispatch({ type: "select", key, gesture }),
    focus: (key, select = true) => dispatch({ type: "focus", key, select }),
    move: (delta, moveOptions) =>
      dispatch({ type: "move", delta, options: moveOptions }),
    first: (moveOptions) => dispatch({ type: "first", options: moveOptions }),
    last: (moveOptions) => dispatch({ type: "last", options: moveOptions }),
    selectAll: () => dispatch({ type: "all" }),
    clear: () => dispatch({ type: "clear" }),
  };
}
