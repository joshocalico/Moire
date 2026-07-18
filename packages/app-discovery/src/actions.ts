export type FileActionSource = "files" | "desktop";

export type FileActionContext = {
  source: FileActionSource;
  paths: string[];
  mimeTypes: string[];
  directories: boolean[];
};

export type ContextAction = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  danger?: boolean;
  separatorBefore?: boolean;
  enabled?: boolean;
  run: () => void;
};

/**
 * A process-local context-menu extension point. Shells and apps register core
 * actions the same way third-party packages register optional additions.
 */
export type ContextActionPlugin = {
  id: string;
  actions(context: FileActionContext): ContextAction[];
};

export class ContextActionRegistry {
  private readonly plugins = new Map<string, ContextActionPlugin>();

  register(plugin: ContextActionPlugin): () => void {
    this.plugins.set(plugin.id, plugin);
    return () => {
      if (this.plugins.get(plugin.id) === plugin) this.plugins.delete(plugin.id);
    };
  }

  actionsFor(context: FileActionContext): ContextAction[] {
    const actions: ContextAction[] = [];
    const seen = new Set<string>();
    for (const plugin of this.plugins.values()) {
      try {
        for (const action of plugin.actions(context)) {
          const id = `${plugin.id}:${action.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          actions.push({ ...action, id });
        }
      } catch (error) {
        console.warn(`[context-actions] plugin ${plugin.id} failed:`, error);
      }
    }
    return actions;
  }
}
