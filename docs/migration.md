# Even Toolkit -- Migration Guide

How to migrate an existing Even Realities app to use `even-toolkit/web` components and design tokens.

---

## Table of Contents

1. [Before You Start](#before-you-start)
2. [Step-by-Step Migration](#step-by-step-migration)
3. [Variant Mapping](#variant-mapping)
4. [Token Mapping](#token-mapping)
5. [Text Class Mapping](#text-class-mapping)
6. [Import Mapping](#import-mapping)
7. [App-Specific Notes](#app-specific-notes)
8. [Verification Checklist](#verification-checklist)

---

## Before You Start

### Prerequisites Checklist

- [ ] Your app uses React 18+ and TypeScript
- [ ] Your app uses Tailwind CSS v3 or v4
- [ ] You have `class-variance-authority` installed (the toolkit depends on it)
- [ ] You have read the [Component Guide](./component-guide.md) and [Theming Guide](./theming.md)
- [ ] You have a working dev environment where you can verify changes visually
- [ ] You have committed all current work (clean git state)

### Install the toolkit

```bash
npm install even-toolkit
# or if it is a local dependency:
npm install ../even-toolkit
```

### Tailwind Configuration

Ensure your `tailwind.config.ts` includes the toolkit's component paths so Tailwind can detect the classes used by toolkit components:

```ts
// tailwind.config.ts
export default {
  content: [
    './src/**/*.{ts,tsx}',
    '../even-toolkit/web/**/*.{ts,tsx}',  // Add this line
  ],
  theme: {
    extend: {
      colors: {
        // Map CSS custom properties to Tailwind color utilities
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-light': 'var(--color-surface-light)',
        'surface-lighter': 'var(--color-surface-lighter)',
        border: 'var(--color-border)',
        'border-light': 'var(--color-border-light)',
        accent: 'var(--color-accent)',
        'accent-alpha': 'var(--color-accent-alpha)',
        'accent-warning': 'var(--color-accent-warning)',
        positive: 'var(--color-positive)',
        'positive-alpha': 'var(--color-positive-alpha)',
        negative: 'var(--color-negative)',
        'negative-alpha': 'var(--color-negative-alpha)',
        overlay: 'var(--color-overlay)',
        'input-bg': 'var(--color-input-bg)',
        text: 'var(--color-text)',
        'text-dim': 'var(--color-text-dim)',
        'text-muted': 'var(--color-text-muted)',
        'text-highlight': 'var(--color-text-highlight)',
      },
    },
  },
};
```

### CSS Setup

Import the toolkit theme files in your app's main CSS (before any app overrides):

```css
/* app.css */
@import 'even-toolkit/web/theme/tokens-light.css';
@import 'even-toolkit/web/theme/typography.css';
@import 'even-toolkit/web/theme/utilities.css';

/* Your app-specific token overrides below */
:root {
  /* --color-accent: #your-accent-color; */
}
```

---

## Step-by-Step Migration

Follow these steps in order. Each step is independently deployable.

### Step 1: Theme tokens (30 min)

Replace all hardcoded color values with design token references.

**Before:**
```css
.card { background: #ffffff; border-radius: 12px; }
.title { color: #333; }
.subtitle { color: #999; }
```

**After:**
```css
.card { background: var(--color-surface); border-radius: 6px; }
.title { color: var(--color-text); }
.subtitle { color: var(--color-text-dim); }
```

Or, using Tailwind classes:
```tsx
// Before
<div className="bg-white rounded-xl">
  <h1 className="text-gray-900">Title</h1>
  <p className="text-gray-500">Subtitle</p>
</div>

// After
<div className="bg-surface rounded-[6px]">
  <h1 className="text-text">Title</h1>
  <p className="text-text-dim">Subtitle</p>
</div>
```

### Step 2: Replace primitive components (1-2 hours)

Start with the most-used primitives. Replace your custom buttons, inputs, cards, badges, and toggles with toolkit versions.

**Priority order:**
1. Button (highest frequency)
2. Card
3. Input / Textarea / Select
4. Toggle
5. Badge
6. Progress

**Before:**
```tsx
<button className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600">
  Save
</button>
```

**After:**
```tsx
import { Button } from 'even-toolkit/web';

<Button variant="highlight" onClick={handleSave}>Save</Button>
```

### Step 3: Replace layout components (1 hour)

Swap your custom navigation, headers, and page wrappers.

**Before:**
```tsx
<div className="min-h-screen pb-8">
  <div className="flex justify-between mb-6">
    <h1 className="text-2xl font-bold">My Page</h1>
    <button>Add</button>
  </div>
  {/* content */}
</div>
```

**After:**
```tsx
import { Page, ScreenHeader, Button } from 'even-toolkit/web';

<Page>
  <ScreenHeader
    title="My Page"
    actions={<Button variant="highlight" size="sm">Add</Button>}
  />
  {/* content */}
</Page>
```

### Step 4: Replace feedback components (30 min)

Migrate dialogs, toasts, loading indicators, and empty states.

### Step 5: Replace complex components (1-2 hours)

Migrate charts, chat interfaces, calendars, file uploads, and other complex components.

### Step 6: Remove old component files (30 min)

After migrating all usages, delete your app's local component files that are now replaced by toolkit imports. Run a project-wide search to ensure no remaining references.

### Step 7: Clean up (30 min)

- Remove unused CSS classes and files
- Remove unused dependencies (e.g., old icon libraries)
- Run linter and type checker
- Test all screens manually

---

## Variant Mapping

### Button Variants

| Old Pattern | New Toolkit Variant |
|-------------|-------------------|
| `bg-blue-500 text-white` / `bg-primary` | `variant="highlight"` |
| `bg-gray-100 text-gray-900` / `bg-secondary` | `variant="default"` |
| `bg-gray-200 text-gray-600` | `variant="secondary"` |
| `bg-transparent text-gray-600 hover:text-gray-900` | `variant="ghost"` |
| `bg-red-100 text-red-600` / `bg-destructive` | `variant="danger"` |

### Button Sizes

| Old Pattern | New Toolkit Size |
|-------------|-----------------|
| `h-8 px-3 text-sm` | `size="sm"` |
| `h-10 px-4` / `h-12 px-4` | `size="default"` |
| `h-12 px-6` | `size="lg"` |
| `h-8 w-8` / `h-9 w-9` (square) | `size="icon"` |

### Card Variants

| Old Pattern | New Toolkit Variant + Padding |
|-------------|------------------------------|
| `bg-white rounded-lg p-4` | `variant="default" padding="default"` |
| `bg-white rounded-lg shadow-lg p-4` | `variant="elevated" padding="default"` |
| `bg-white rounded-lg p-4 hover:bg-gray-50 cursor-pointer` | `variant="interactive" padding="default"` |
| `bg-white rounded-lg p-6` | `padding="lg"` |
| `bg-white rounded-lg p-3` | `padding="sm"` |

### Badge Variants

| Old Pattern | New Toolkit Variant |
|-------------|-------------------|
| `bg-green-100 text-green-700` | `variant="positive"` |
| `bg-red-100 text-red-700` | `variant="negative"` |
| `bg-blue-100 text-blue-700` / `bg-accent-*` | `variant="accent"` |
| `bg-gray-100 text-gray-600` | `variant="neutral"` |

### Toast Variants

| Old Pattern | New Toolkit Variant |
|-------------|-------------------|
| Default / informational | `variant="info"` |
| Warning / caution | `variant="warning"` |
| Error / failure | `variant="error"` |
| With undo action | `variant="undo"` |

### Divider Variants

| Old Pattern | New Toolkit Variant |
|-------------|-------------------|
| `<hr>` / `border-t` with no margin | `variant="default"` |
| `<hr>` with `my-6` / vertical spacing | `variant="spaced"` |

---

## Token Mapping

### Colors

| Old Tailwind / CSS | New Token / Tailwind |
|--------------------|---------------------|
| `bg-white` | `bg-surface` |
| `bg-gray-50` / `bg-gray-100` | `bg-surface-light` |
| `bg-gray-200` | `bg-surface-lighter` |
| `bg-gray-100` (page bg) | `bg-bg` |
| `text-gray-900` / `text-black` | `text-text` |
| `text-gray-500` / `text-gray-600` | `text-text-dim` |
| `text-gray-400` | `text-text-muted` |
| `text-white` (on accent) | `text-text-highlight` |
| `bg-blue-500` / `bg-primary` | `bg-accent` |
| `bg-green-500` | `bg-positive` |
| `bg-red-500` | `bg-negative` |
| `border-gray-200` | `border-border` |
| `border-gray-100` | `border-border-light` |
| `bg-yellow-100` / `bg-amber-100` | `bg-accent-warning` |
| `bg-black/50` (overlay) | `bg-overlay` |

### Border Radius

| Old Value | New Value |
|-----------|-----------|
| `rounded-lg` (8px) | `rounded-[6px]` |
| `rounded-xl` (12px) | `rounded-[6px]` |
| `rounded-2xl` (16px) | `rounded-[6px]` |
| `rounded-md` (6px) | `rounded-[6px]` |
| `rounded-full` | `rounded-full` (keep as-is for circles) |

The toolkit uses a uniform 6px border radius for all rectangular elements.

### Spacing

| Old Pattern | New Token |
|-------------|-----------|
| `px-4` (page margin) | `px-3` (12px = `--spacing-margin`) |
| `p-4` (card padding) | `p-4` (16px = `--spacing-card-margin`) |
| `gap-2` (between similar) | `gap-[6px]` (= `--spacing-same`) |
| `gap-3` (between different) | `gap-3` (12px = `--spacing-cross`) |
| `mb-6` (section gap) | `mb-6` (24px = `--spacing-section`) |

---

## Text Class Mapping

### Font Sizes

| Old Tailwind | New Toolkit Pattern | Equivalent Class |
|-------------|--------------------|--------------------|
| `text-2xl font-bold` | `text-[24px] tracking-[-0.72px] font-normal` | `.text-vlarge-title` |
| `text-xl font-semibold` | `text-[20px] tracking-[-0.6px] font-normal` | `.text-large-title` |
| `text-base font-medium` | `text-[17px] tracking-[-0.17px] font-normal` | `.text-medium-title` |
| `text-base` | `text-[17px] tracking-[-0.17px] font-light` | `.text-medium-body` |
| `text-sm font-medium` | `text-[15px] tracking-[-0.15px] font-normal` | `.text-normal-title` |
| `text-sm` | `text-[15px] tracking-[-0.15px] font-light` | `.text-normal-body` |
| `text-xs` | `text-[13px] tracking-[-0.13px]` | `.text-subtitle` |
| `text-[10px]` / `text-[11px]` | `text-[11px] tracking-[-0.11px]` | `.text-detail` |

**Key differences:**
- The toolkit never uses `font-bold` or `font-semibold`. All text is `font-normal` (400) or `font-light` (300).
- Every text size has a matching negative letter-spacing value.
- Use the toolkit's 8 defined sizes. Do not invent new sizes.

---

## Import Mapping

### Common component renames

| Old Import (app-local) | New Import (toolkit) |
|------------------------|---------------------|
| `import { Button } from '@/components/ui/button'` | `import { Button } from 'even-toolkit/web'` |
| `import { Card } from '@/components/ui/card'` | `import { Card } from 'even-toolkit/web'` |
| `import { Input } from '@/components/ui/input'` | `import { Input } from 'even-toolkit/web'` |
| `import { Dialog } from '@/components/ui/dialog'` | `import { Dialog } from 'even-toolkit/web'` |
| `import { Switch } from '@/components/ui/switch'` | `import { Toggle } from 'even-toolkit/web'` |
| `import { Chip } from '@/components/ui/chip'` | `import { Pill } from 'even-toolkit/web'` |
| `import { Tabs } from '@/components/ui/tabs'` | `import { SegmentedControl } from 'even-toolkit/web'` |
| `import { Spinner } from '@/components/ui/spinner'` | `import { Loading } from 'even-toolkit/web'` |
| `import { Modal } from '@/components/ui/modal'` | `import { Dialog } from 'even-toolkit/web'` |
| `import { Alert } from '@/components/ui/alert'` | `import { Toast } from 'even-toolkit/web'` |
| `import { Breadcrumb } from '@/components/ui/breadcrumb'` | `import { NavHeader } from 'even-toolkit/web'` |
| `import { Header } from '@/components/header'` | `import { ScreenHeader } from 'even-toolkit/web'` |
| `import { cn } from '@/lib/utils'` | `import { cn } from 'even-toolkit/web'` |

### Prop name changes

| Old Prop | New Prop | Component |
|----------|----------|-----------|
| `onClick` | `onPress` | ListItem, Tag, TagCard |
| `onChange` (select event) | `onValueChange` (string) | Select |
| `isOpen` | `open` | Dialog, BottomSheet, ConfirmDialog |
| `onDismiss` / `onRequestClose` | `onClose` | Dialog, BottomSheet |
| `label` / `text` (button) | `children` | Button |
| `color="success"` | `variant="positive"` | Badge |
| `color="error"` | `variant="negative"` | Badge |
| `size="xs"` | `size="sm"` | Button |
| `size="xl"` | `size="lg"` | Button |
| `isLoading` | render `<Loading />` inside children | Button |
| `leftIcon` / `startIcon` | Place icon in `children` | Button |

---

## App-Specific Notes

### Even Market

**Accent color:** Gold `#f0b429`

```css
:root {
  --color-accent: #f0b429;
  --color-accent-alpha: rgba(240,180,41,0.12);
  --color-text-highlight: #1a1a1a;  /* dark text on gold */
}
```

**Specific migrations:**
- Replace product card components with `Card variant="interactive"`
- Replace price badges with `Badge variant="accent"` or `Badge variant="positive"`
- Replace the custom bottom tab bar with `NavBar`
- Replace search input with `SearchBar`
- Replace product grid with `ListItem` or custom Card layouts
- The cart count badge should use `Badge variant="accent"`

### Even Kitchen

**Accent color:** Dynamic per context, default dark `#232323`

**Specific migrations:**
- Replace timer UI with `TimerRing`
- Replace recipe step lists with `Card` + step number pattern (see Detail Page pattern)
- Replace ingredient checklist with `Checkbox` + `ListItem`
- Replace the cooking mode bottom bar with `CTAGroup layout="side-by-side"`
- Replace nutrition display with `StatGrid` or `PieChart`
- The recipe category filter should use `CategoryFilter`
- Step completion tracking maps to `StatusProgress`

### Even Browser

**Accent color:** Blue `#3b82f6`

```css
:root {
  --color-accent: #3b82f6;
  --color-accent-alpha: rgba(59,130,246,0.12);
  --color-text-highlight: #FFFFFF;
}
```

**Specific migrations:**
- Replace bookmark list with `ListItem` components
- Replace tab switcher with `SegmentedControl`
- Replace the URL input bar with `SearchBar` (or `Input` with custom styling)
- Replace history entries with `Timeline`
- Replace download progress with `Progress`
- Settings page maps directly to the Settings Page pattern

---

## Verification Checklist

After completing the migration, verify each of the following:

### Visual Consistency

- [ ] All border radii are 6px (no rounded-lg, rounded-xl remnants)
- [ ] No hardcoded color values remain (search for `#` in className strings and inline styles)
- [ ] Text sizes match the 8 defined sizes (24, 20, 17, 15, 13, 11 px)
- [ ] No `font-bold` or `font-semibold` usage (except inside toolkit components)
- [ ] Page backgrounds use `bg-bg`, cards use `bg-surface`
- [ ] Accent color is correctly applied via `--color-accent` token

### Functional Correctness

- [ ] All buttons respond to clicks and show disabled states
- [ ] All inputs accept text and show placeholder styling
- [ ] All toggles switch on/off
- [ ] All dialogs open and close (overlay click + Escape key)
- [ ] Navigation bar highlights the active item
- [ ] Search bar filters content correctly
- [ ] Empty states appear when lists are empty

### Imports

- [ ] No remaining imports from local `@/components/ui/*` that duplicate toolkit components
- [ ] All toolkit imports come from `'even-toolkit/web'`
- [ ] Local component files that are fully replaced have been deleted
- [ ] `cn` utility is imported from `'even-toolkit/web'` (not a local copy)

### Theming

- [ ] App-specific CSS overrides are in `app.css` (not scattered in component files)
- [ ] Dark mode tokens are defined if dark mode is supported
- [ ] The `--color-text-highlight` value works well on the accent color background

### Build and Type Safety

- [ ] `tsc --noEmit` passes with no errors
- [ ] Build completes successfully
- [ ] No runtime console errors
- [ ] Tailwind classes from toolkit are included in the build output

### Performance

- [ ] Bundle size has not increased significantly (toolkit replaces local code)
- [ ] No duplicate React instances (check with React DevTools)
- [ ] Scrolling performance is smooth on lists with many items
