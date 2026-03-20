# Even Toolkit -- Theming Guide

How the design token system works, how to create app themes, and the complete token reference.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Complete Token Reference](#complete-token-reference)
3. [Light Theme Values](#light-theme-values)
4. [Dark Theme Values](#dark-theme-values)
5. [Creating App Themes](#creating-app-themes)
6. [Theme Examples](#theme-examples)
7. [Font System](#font-system)
8. [Typography Classes](#typography-classes)
9. [Border Radius System](#border-radius-system)
10. [Spacing System](#spacing-system)

---

## Architecture

The toolkit uses CSS custom properties (design tokens) defined on `:root`. Every component references these tokens via Tailwind utility classes that map to the token values.

```
even-toolkit/web/theme/
  tokens-light.css   -- Light theme token definitions
  tokens-dark.css    -- Dark theme token definitions
  typography.css     -- 8 text style classes
  utilities.css      -- Shared CSS utilities (scrollbar-hide, animations)
```

**How it works:**

1. The toolkit ships `tokens-light.css` as the default theme (applied to `:root`).
2. Your app imports the toolkit theme CSS, then overrides specific tokens in its own `app.css`.
3. All toolkit components automatically pick up your overrides because they reference `var(--color-*)` tokens.

```css
/* Your app.css -- import toolkit theme first, then override */
@import 'even-toolkit/web/theme/tokens-light.css';
@import 'even-toolkit/web/theme/typography.css';
@import 'even-toolkit/web/theme/utilities.css';

/* Override accent color for your app */
:root {
  --color-accent: #f0b429;
}
```

---

## Complete Token Reference

### Text Colors

| Token | Purpose |
|-------|---------|
| `--color-text` | Primary text color (TC-1st) |
| `--color-text-dim` | Secondary/dimmed text (TC-2nd) |
| `--color-text-muted` | Tertiary/muted text (alias for TC-2nd) |
| `--color-text-highlight` | Text on accent backgrounds (TC-Highlight) |

### Background Colors

| Token | Purpose |
|-------|---------|
| `--color-bg` | Main page background (BC-3rd) |
| `--color-surface` | Card/component background (BC-1st) |
| `--color-surface-light` | Hover state, secondary surface (BC-2nd) |
| `--color-surface-lighter` | Tertiary surface, disabled states (BC-4th) |

### Border Colors

| Token | Purpose |
|-------|---------|
| `--color-border` | Default border color |
| `--color-border-light` | Lighter border for subtle dividers |

### Accent and Semantic

| Token | Purpose |
|-------|---------|
| `--color-accent` | Primary accent / highlight color (BC-Highlight) |
| `--color-accent-alpha` | Translucent accent for backgrounds |
| `--color-accent-warning` | Warning/attention color (yellow) |

### Status Colors

| Token | Purpose |
|-------|---------|
| `--color-positive` | Success, active, connected (green) |
| `--color-positive-alpha` | Translucent positive for badge backgrounds |
| `--color-negative` | Error, destructive, disconnected (red) |
| `--color-negative-alpha` | Translucent negative for badge backgrounds |

### Overlay and Input

| Token | Purpose |
|-------|---------|
| `--color-overlay` | Semi-transparent backdrop for dialogs |
| `--color-input-bg` | Input field background |

### Layout

| Token | Purpose |
|-------|---------|
| `--radius-default` | Default border radius (always `6px`) |
| `--spacing-margin` | Page horizontal margin (`12px`) |
| `--spacing-card-margin` | Card internal padding (`16px`) |
| `--spacing-same` | Gap between similar items (`6px`) |
| `--spacing-cross` | Gap between different items (`12px`) |
| `--spacing-section` | Gap between sections (`24px`) |

### Fonts

| Token | Purpose |
|-------|---------|
| `--font-display` | Display/heading font family |
| `--font-body` | Body text font family |
| `--font-mono` | Monospace font family |

---

## Light Theme Values

These are the default values from `tokens-light.css`:

```css
:root {
  /* Text Colors */
  --color-text: #232323;
  --color-text-dim: #7B7B7B;
  --color-text-muted: #7B7B7B;
  --color-text-highlight: #FFFFFF;

  /* Background Colors */
  --color-bg: #EEEEEE;
  --color-surface: #FFFFFF;
  --color-surface-light: #F6F6F6;
  --color-surface-lighter: #E4E4E4;

  /* Border Colors */
  --color-border: #E4E4E4;
  --color-border-light: #EEEEEE;

  /* Accent & Semantic */
  --color-accent: #232323;
  --color-accent-alpha: rgba(35,35,35,0.08);
  --color-accent-warning: #FEF991;

  /* Status */
  --color-positive: #4BB956;
  --color-positive-alpha: rgba(75,185,86,0.15);
  --color-negative: #FF453A;
  --color-negative-alpha: rgba(255,69,58,0.15);

  /* Overlay & Input */
  --color-overlay: rgba(0,0,0,0.50);
  --color-input-bg: rgba(35,35,35,0.08);

  /* Layout */
  --radius-default: 6px;
  --spacing-margin: 12px;
  --spacing-card-margin: 16px;
  --spacing-same: 6px;
  --spacing-cross: 12px;
  --spacing-section: 24px;

  /* Fonts */
  --font-display: "FK Grotesk Neue", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: "FK Grotesk Neue", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: "SF Mono", "Cascadia Code", "Fira Code", monospace;
}
```

---

## Dark Theme Values

From `tokens-dark.css`:

```css
:root {
  /* Text Colors */
  --color-text: #f0ebe3;
  --color-text-dim: #8a7f72;
  --color-text-muted: #5c5347;
  --color-text-highlight: #FFFFFF;

  /* Background Colors */
  --color-bg: #0c0a07;
  --color-surface: #161310;
  --color-surface-light: #201c17;
  --color-surface-lighter: #2c2620;

  /* Border Colors */
  --color-border: #28221a;
  --color-border-light: #3a3228;

  /* Accent & Semantic */
  --color-accent: #FFFFFF;
  --color-accent-alpha: rgba(255,255,255,0.12);
  --color-accent-warning: #FEF991;

  /* Status */
  --color-positive: #26a69a;
  --color-positive-alpha: rgba(38,166,154,0.50);
  --color-negative: #ef5350;
  --color-negative-alpha: rgba(239,83,80,0.15);

  /* Overlay & Input */
  --color-overlay: rgba(0,0,0,0.60);
  --color-input-bg: rgba(255,255,255,0.08);

  /* Layout */
  --radius-default: 6px;
  --spacing-margin: 12px;
  --spacing-card-margin: 16px;
  --spacing-same: 6px;
  --spacing-cross: 12px;
  --spacing-section: 24px;

  /* Fonts */
  --font-display: "FK Grotesk Neue", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: "FK Grotesk Neue", -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: "SF Mono", "Cascadia Code", "Fira Code", monospace;
}
```

---

## Creating App Themes

To theme your app, import the base toolkit CSS and then override the tokens you want to change. You only need to override what differs from the defaults.

### Step 1: Import base theme

```css
/* app.css */
@import 'even-toolkit/web/theme/tokens-light.css';
@import 'even-toolkit/web/theme/typography.css';
@import 'even-toolkit/web/theme/utilities.css';
```

### Step 2: Override tokens

```css
/* app.css (continued) */
:root {
  --color-accent: #f0b429;
  --color-accent-alpha: rgba(240,180,41,0.12);
}
```

### Step 3: Dark mode support

If your app supports dark mode, use a media query or class-based switch:

```css
/* Option A: System preference */
@media (prefers-color-scheme: dark) {
  :root {
    --color-text: #f0ebe3;
    --color-bg: #0c0a07;
    --color-surface: #161310;
    /* ... override all dark tokens */
  }
}

/* Option B: Class-based (toggled via JS) */
.dark {
  --color-text: #f0ebe3;
  --color-bg: #0c0a07;
  /* ... */
}
```

---

## Theme Examples

### Even Market (Gold Accent)

Market uses a warm gold accent color for its highlight elements.

```css
:root {
  --color-accent: #f0b429;
  --color-accent-alpha: rgba(240,180,41,0.12);
  --color-text-highlight: #1a1a1a;  /* dark text on gold */
}
```

**Result:** Buttons, active nav items, progress bars, and selected filters all appear in gold. Text on gold backgrounds reads as dark.

### Even Kitchen (Dynamic Recipe Accent)

Kitchen can dynamically change the accent per recipe context using JavaScript:

```ts
// Set accent color dynamically
function setRecipeTheme(color: string) {
  document.documentElement.style.setProperty('--color-accent', color);
  document.documentElement.style.setProperty(
    '--color-accent-alpha',
    color.replace(')', ',0.12)').replace('rgb', 'rgba')
  );
}

// Usage
setRecipeTheme('#e85d04');  // Orange for Italian
setRecipeTheme('#2d6a4f');  // Green for salads
```

### Even Browser (Blue Accent)

Browser uses a standard blue accent.

```css
:root {
  --color-accent: #3b82f6;
  --color-accent-alpha: rgba(59,130,246,0.12);
  --color-text-highlight: #FFFFFF;
}
```

### Minimal Overrides Required

Because all components reference tokens, changing just `--color-accent` and `--color-accent-alpha` transforms the entire UI. For a full theme switch (light to dark), override the background and text tokens as well.

**Minimum for accent-only customization (3 tokens):**

```css
:root {
  --color-accent: <your-color>;
  --color-accent-alpha: <your-color-at-12%-opacity>;
  --color-text-highlight: <text-on-accent>;  /* usually #FFFFFF or #1a1a1a */
}
```

**Full theme customization (all color tokens):** Override all `--color-*` tokens listed in the reference above.

---

## Font System

The design system uses **FK Grotesk Neue** as the primary typeface for both display and body text. If unavailable, it falls back to the system font stack.

| Token | Stack |
|-------|-------|
| `--font-display` | `"FK Grotesk Neue", -apple-system, BlinkMacSystemFont, sans-serif` |
| `--font-body` | `"FK Grotesk Neue", -apple-system, BlinkMacSystemFont, sans-serif` |
| `--font-mono` | `"SF Mono", "Cascadia Code", "Fira Code", monospace` |

### Loading FK Grotesk Neue

Ensure the font files are loaded in your app's HTML or CSS:

```html
<link rel="preload" href="/fonts/FKGroteskNeue-Regular.woff2" as="font" type="font/woff2" crossorigin />
```

```css
@font-face {
  font-family: "FK Grotesk Neue";
  src: url("/fonts/FKGroteskNeue-Regular.woff2") format("woff2");
  font-weight: 300 400;
  font-display: swap;
}
```

---

## Typography Classes

The toolkit provides 8 pre-defined text style classes in `typography.css`. All use `font-weight: 400` (regular) except body variants which use `300` (light).

| Class | Size | Weight | Letter Spacing | Use For |
|-------|------|--------|----------------|---------|
| `.text-vlarge-title` | 24px | 400 | -0.72px | Screen titles, hero text |
| `.text-large-title` | 20px | 400 | -0.6px | Section headers |
| `.text-medium-title` | 17px | 400 | -0.17px | Card titles, nav items, buttons |
| `.text-medium-body` | 17px | 300 | -0.17px | Body paragraphs at 17px |
| `.text-normal-title` | 15px | 400 | -0.15px | List item titles, smaller headings |
| `.text-normal-body` | 15px | 300 | -0.15px | Default body text, descriptions |
| `.text-subtitle` | 13px | 400 | -0.13px | Subtitles, captions, helper text |
| `.text-detail` | 11px | 400 | -0.11px | Timestamps, tiny labels, fine print |

### Usage in Tailwind

Most components apply these sizes inline via Tailwind classes rather than the CSS classes:

```tsx
{/* Equivalent to .text-vlarge-title */}
<h1 className="text-[24px] tracking-[-0.72px] font-normal">Title</h1>

{/* Equivalent to .text-subtitle */}
<span className="text-[13px] tracking-[-0.13px] text-text-dim">Caption</span>
```

---

## Border Radius System

The design system uses a **single border radius value: 6px** for all components.

```css
--radius-default: 6px;
```

Every component uses `rounded-[6px]` in its Tailwind classes. This creates a subtle, consistent rounding across the entire UI. The only exceptions are:

- **Fully round elements:** Toggle knobs, status dots, avatar circles use `rounded-full`.
- **Kbd component:** Uses `rounded-[4px]` for a slightly tighter feel.

Do not use other radius values (8px, 12px, 16px, etc.) in Even apps. The 6px radius is part of the brand identity.

---

## Spacing System

The design system defines spacing tokens for consistent layout:

| Token | Value | Usage |
|-------|-------|-------|
| `--spacing-margin` | `12px` | Page horizontal margins, container padding |
| `--spacing-card-margin` | `16px` | Card internal padding (Card `padding="default"`) |
| `--spacing-same` | `6px` | Gap between same-type items (e.g., two buttons) |
| `--spacing-cross` | `12px` | Gap between different items (e.g., title and list) |
| `--spacing-section` | `24px` | Gap between major sections |

These tokens are available but most components apply spacing via Tailwind utility classes directly. Use the tokens in custom layouts for consistency:

```css
.my-custom-section {
  padding: var(--spacing-card-margin);
  margin-bottom: var(--spacing-section);
}
```
