# Widget Showcase

`apps/showcase` is the live conformance surface for `@moire/ui`. It is both a
widget catalog and a renderer stress test: the left-hand navigation is a real
`NavigationSidebar`, each preview is interactive, and the Code tab renders the
corresponding TSX through `CodeView` and the shared `RichTextView` primitive.

Run it inside a Moire session with:

```sh
moire-showcase
moire-showcase --sample table
```

The session installs its launcher and desktop entry automatically. New public
widgets should normally arrive with a representative showcase sample and a
headless smoke assertion. This keeps API design, keyboard/focus behavior,
software rendering, EGL rendering, and visual taste under one observable
surface.

The showcase intentionally uses ordinary JSX. It should not gain privileged
knowledge of Wayland or a rendering backend.

Composition is part of its contract: content-specific surfaces should expose
the smaller general primitive below them. For example, `CodeView` tokenizes
into `RichTextView`, while `TerminalView` adds caret and keyboard semantics to
the same rich-text viewport.

The current catalog also exercises fixed-row virtualization at 10,000 items,
sortable tables, expandable trees, resizable split panes, condensed
pagination, sectioned property inspectors, tooltip motion, disclosures, and
composed operation progress. Each public sample has a matching prop table in
[`ui/widgets.md`](../ui/widgets.md); the Code tab is illustrative usage rather
than a substitute for that API reference.
