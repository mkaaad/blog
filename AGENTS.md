## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)

## Homepage Terminal (keyboard-only)

The homepage terminal in `src/components/Terminal.astro` is keyboard-only:

- Clicking anywhere inside the terminal focuses the input (kept as a convenience).
- No other mouse interactions: no click-to-select candidates, no hover / pointer handlers, no `cursor` affordances.
- Tab cycles completion candidates, ↑/↓ navigate history, Enter executes commands.
- Links stay plain `<a>` elements (keyboard reachable) and must not rely on mouse events or hover styles.

- Internal page-jump commands (currently `blog` → `/blog`) must call `navigateTo(path)` so Astro View Transitions run: the terminal snapshot is erased line-by-line from left to right, top to bottom (`clip-path` steps, no scan line), revealing the destination page underneath. External-link commands (`social`) stay plain `<a>` output.
