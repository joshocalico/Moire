/** A window's folder tabs: which exist, which is active, and how they open, move and close. */
import { useCallback, useRef, useState } from "react";
import { createFolderTab, tabDirectory, type FolderTab } from "./navigation";

export function useFolderTabs(
  initialPath: string,
  options: { busy: boolean; onLastClosed(): void; onActivate(): void },
) {
  const [tabs, setTabs] = useState(() => [createFolderTab("folder-1", initialPath)]);
  const [activeId, setActiveId] = useState("folder-1");
  const nextId = useRef(2);
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0]!;
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === active.id),
  );
  const updateTab = useCallback((id: string, change: (tab: FolderTab) => FolderTab) => {
    setTabs((current) => current.map((tab) => (tab.id === id ? change(tab) : tab)));
  }, []);
  // Tabs stay put while an operation runs: its progress belongs to the active tab.
  const activate = (id: string) => {
    if (options.busy) return;
    options.onActivate();
    setActiveId(id);
  };
  const add = (directory = tabDirectory(active), at = tabs.length) => {
    if (options.busy) return;
    const tab = createFolderTab(`folder-${nextId.current++}`, directory);
    setTabs((current) => [...current.slice(0, at), tab, ...current.slice(at)]);
    options.onActivate();
    setActiveId(tab.id);
  };
  const closeWhere = (keep: (tab: FolderTab, index: number) => boolean) => {
    if (options.busy) return;
    const remaining = tabs.filter(keep);
    if (!remaining.length) {
      options.onLastClosed();
      return;
    }
    setTabs(remaining);
    if (!remaining.some((tab) => tab.id === activeId)) {
      options.onActivate();
      setActiveId(remaining[Math.min(activeIndex, remaining.length - 1)]!.id);
    }
  };
  return {
    tabs,
    setTabs,
    active,
    activeIndex,
    updateTab,
    activate,
    add,
    close: (index: number) => closeWhere((_, candidate) => candidate !== index),
    closeOthers: (index: number) => closeWhere((_, candidate) => candidate === index),
    change: (offset: number) => {
      const next = tabs[(activeIndex + offset + tabs.length) % tabs.length];
      if (next) activate(next.id);
    },
    move: (index: number, offset: -1 | 1) =>
      setTabs((current) => {
        const target = index + offset;
        if (target < 0 || target >= current.length) return current;
        const next = [...current];
        const [moving] = next.splice(index, 1);
        next.splice(target, 0, moving!);
        return next;
      }),
  };
}
