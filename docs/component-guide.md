# Even Toolkit -- Component Guide

Complete reference for all web UI components exported from `even-toolkit/web`.

All components are imported from the package entry point:

```tsx
import { Button, Card, Badge /* ... */ } from 'even-toolkit/web';
```

---

## Table of Contents

1. [Primitives](#1-primitives)
2. [Layout and Navigation](#2-layout-and-navigation)
3. [Feedback and Overlay](#3-feedback-and-overlay)
4. [Tags and Indicators](#4-tags-and-indicators)
5. [Chat](#5-chat)
6. [Calendar](#6-calendar)
7. [Charts](#7-charts)
8. [Data Visualization](#8-data-visualization)
9. [Media and Input](#9-media-and-input)

---

## 1. Primitives

### Button

A versatile button with five visual variants and four sizes. Built with CVA.

```tsx
import { Button } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'highlight' \| 'default' \| 'ghost' \| 'danger' \| 'secondary'` | `'highlight'` | Visual style of the button |
| size | `'sm' \| 'default' \| 'lg' \| 'icon'` | `'default'` | Button size. `icon` produces a 36x36 square |
| className | `string` | -- | Additional CSS classes |
| ...rest | `ButtonHTMLAttributes` | -- | All native button attributes (onClick, disabled, etc.) |

**When to use:** Primary actions (highlight), secondary actions (default/secondary), destructive actions (danger), toolbar/inline actions (ghost), icon-only buttons (icon size).

```tsx
<Button variant="highlight" onClick={handleSave}>Save Recipe</Button>
<Button variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
<Button variant="ghost" size="icon"><Icon name="settings" /></Button>
```

---

### Card

A rounded container for grouping related content.

```tsx
import { Card } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'default' \| 'elevated' \| 'interactive'` | `'default'` | Visual style. `elevated` adds shadow, `interactive` adds hover state |
| padding | `'none' \| 'sm' \| 'default' \| 'lg'` | `'default'` | Inner padding (0/12/16/24 px) |
| className | `string` | -- | Additional CSS classes |
| ...rest | `HTMLAttributes<HTMLDivElement>` | -- | All native div attributes |

**When to use:** Wrapping content sections, list items with details, settings groups, dashboard widgets.

```tsx
<Card variant="interactive" padding="lg" onClick={openDetail}>
  <h3>Pasta Carbonara</h3>
  <p>Ready in 25 min</p>
</Card>
```

---

### Badge

A small inline label for status or categorization.

```tsx
import { Badge } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'positive' \| 'negative' \| 'accent' \| 'neutral'` | `'neutral'` | Color scheme |
| className | `string` | -- | Additional CSS classes |
| children | `ReactNode` | -- | Badge content (text) |

**When to use:** Status labels (online/offline), tag counts, notification indicators.

```tsx
<Badge variant="positive">In Stock</Badge>
<Badge variant="negative">Expired</Badge>
<Badge variant="accent">New</Badge>
```

---

### Input

A single-line text input with toolkit styling.

```tsx
import { Input } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| type | `string` | `'text'` | HTML input type |
| className | `string` | -- | Additional CSS classes |
| ...rest | `InputHTMLAttributes` | -- | All native input attributes (placeholder, value, onChange, etc.) |

**When to use:** Any single-line text entry -- names, emails, search queries, numbers.

```tsx
<Input placeholder="Recipe name" value={name} onChange={e => setName(e.target.value)} />
```

---

### Textarea

A multi-line text input that matches the toolkit's styling.

```tsx
import { Textarea } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| rows | `number` | `3` | Number of visible text rows |
| className | `string` | -- | Additional CSS classes |
| ...rest | `TextareaHTMLAttributes` | -- | All native textarea attributes |

**When to use:** Longer text content -- descriptions, notes, instructions.

```tsx
<Textarea placeholder="Cooking instructions..." rows={5} value={instructions} onChange={e => setInstructions(e.target.value)} />
```

---

### Select

A native dropdown select with toolkit styling.

```tsx
import { Select } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| options | `SelectOption[]` | required | Array of `{ value: string; label: string }` |
| onValueChange | `(value: string) => void` | -- | Called when selection changes |
| className | `string` | -- | Additional CSS classes |
| ...rest | `SelectHTMLAttributes` (minus onChange) | -- | Native select attributes (value, disabled, etc.) |

**When to use:** Choosing from a fixed list of options -- categories, units, sort order.

```tsx
<Select
  options={[
    { value: 'g', label: 'Grams' },
    { value: 'ml', label: 'Milliliters' },
    { value: 'pcs', label: 'Pieces' },
  ]}
  value={unit}
  onValueChange={setUnit}
/>
```

---

### Progress

A horizontal progress bar.

```tsx
import { Progress } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| value | `number` | required | Progress percentage (0--100) |
| className | `string` | -- | Additional CSS classes |

**When to use:** Upload progress, recipe completion, step progress.

```tsx
<Progress value={65} />
```

---

### StatusDot

A small colored dot indicating connection or status.

```tsx
import { StatusDot } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| connected | `boolean` | required | `true` = green pulsing dot, `false` = red dot |
| className | `string` | -- | Additional CSS classes |

**When to use:** Glasses connection indicator, service health status.

```tsx
<StatusDot connected={isGlassesConnected} />
```

---

### Pill

A removable chip/tag for selected items.

```tsx
import { Pill } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| label | `string` | required | Display text |
| onRemove | `() => void` | -- | If provided, shows a remove button |
| className | `string` | -- | Additional CSS classes |

**When to use:** Selected filters, ingredient tags, multi-select results.

```tsx
<Pill label="Vegetarian" onRemove={() => removeFilter('vegetarian')} />
```

---

### Toggle

A boolean switch control (iOS-style).

```tsx
import { Toggle } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| checked | `boolean` | required | Whether the toggle is on |
| onChange | `(checked: boolean) => void` | required | Called when toggled |
| disabled | `boolean` | -- | Disables interaction |
| className | `string` | -- | Additional CSS classes |

**When to use:** Settings on/off, feature flags, notification preferences.

```tsx
<Toggle checked={notifications} onChange={setNotifications} />
```

---

### SegmentedControl

A horizontal tab-like picker for mutually exclusive options.

```tsx
import { SegmentedControl } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| options | `SegmentedControlOption[]` | required | Array of `{ value: string; label: string }` |
| value | `string` | required | Currently selected value |
| onValueChange | `(value: string) => void` | required | Called when selection changes |
| size | `'default' \| 'small' \| 'xsmall'` | `'default'` | Control height (48/36/24 px) |
| className | `string` | -- | Additional CSS classes |

**When to use:** View mode switcher, filter type selection, tab-like navigation within a section.

```tsx
<SegmentedControl
  options={[
    { value: 'all', label: 'All' },
    { value: 'favorites', label: 'Favorites' },
    { value: 'recent', label: 'Recent' },
  ]}
  value={view}
  onValueChange={setView}
/>
```

---

### Table, TableHeader, TableBody, TableRow, TableHead, TableCell

A styled table system with six composable sub-components.

```tsx
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from 'even-toolkit/web';
```

All sub-components accept `className` and their native HTML element attributes.

| Component | Renders | Notes |
|-----------|---------|-------|
| Table | `<div>` wrapper + `<table>` | Rounded container with horizontal scroll |
| TableHeader | `<thead>` | Subtle background tint |
| TableBody | `<tbody>` | Standard body |
| TableRow | `<tr>` | Hover highlight, bottom border |
| TableHead | `<th>` | Dimmed label text, 13px |
| TableCell | `<td>` | Tabular-nums, no-wrap |

**When to use:** Structured data display -- ingredient lists, order histories, price tables.

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Ingredient</TableHead>
      <TableHead>Quantity</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow>
      <TableCell>Flour</TableCell>
      <TableCell>250g</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

---

### Kbd

Renders an inline keyboard shortcut indicator.

```tsx
import { Kbd } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| children | `ReactNode` | required | Key label content |
| className | `string` | -- | Additional CSS classes |

**When to use:** Displaying keyboard shortcuts in tooltips or help text.

```tsx
<Kbd>Cmd</Kbd> + <Kbd>S</Kbd>
```

---

### Divider

A horizontal line separator.

```tsx
import { Divider } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'default' \| 'spaced'` | `'default'` | `spaced` adds 24px vertical margin |
| className | `string` | -- | Additional CSS classes |

**When to use:** Separating content sections within a card or page.

```tsx
<Divider variant="spaced" />
```

---

### Checkbox

A custom checkbox with optional label.

```tsx
import { Checkbox } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| checked | `boolean` | required | Whether checked |
| onChange | `(checked: boolean) => void` | required | Called when toggled |
| label | `string` | -- | Optional text label |
| disabled | `boolean` | -- | Disables interaction |
| className | `string` | -- | Additional CSS classes |

**When to use:** Multi-select options, to-do items, ingredient checklists.

```tsx
<Checkbox checked={agreed} onChange={setAgreed} label="I agree to the terms" />
```

---

### RadioGroup

A group of mutually exclusive radio options.

```tsx
import { RadioGroup } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| options | `RadioOption[]` | required | Array of `{ value: string; label: string }` |
| value | `string` | required | Currently selected value |
| onChange | `(value: string) => void` | required | Called on selection change |
| direction | `'horizontal' \| 'vertical'` | `'vertical'` | Layout direction |
| disabled | `boolean` | -- | Disables all options |
| className | `string` | -- | Additional CSS classes |

**When to use:** Single-choice settings, difficulty level, serving size selection.

```tsx
<RadioGroup
  options={[
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
  ]}
  value={difficulty}
  onChange={setDifficulty}
/>
```

---

### Slider

A range slider with optional left/right icons.

```tsx
import { Slider } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| value | `number` | required | Current value |
| onChange | `(value: number) => void` | required | Called on value change |
| min | `number` | `0` | Minimum value |
| max | `number` | `100` | Maximum value |
| step | `number` | `1` | Step increment |
| leftIcon | `ReactNode` | -- | Icon before the track |
| rightIcon | `ReactNode` | -- | Icon after the track |
| disabled | `boolean` | -- | Disables interaction |
| className | `string` | -- | Additional CSS classes |

**When to use:** Volume control, brightness, temperature setting, serving count.

```tsx
<Slider value={servings} onChange={setServings} min={1} max={12} step={1} />
```

---

### Skeleton

A loading placeholder with pulse animation.

```tsx
import { Skeleton } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| width | `string \| number` | -- | Width (number = px, string = CSS value) |
| height | `string \| number` | `'16px'` | Height |
| rounded | `'default' \| 'full' \| 'none'` | `'default'` | Border radius style |
| className | `string` | -- | Additional CSS classes |

**When to use:** Content loading placeholders to prevent layout shift.

```tsx
<Skeleton width={200} height={20} />
<Skeleton width={120} height={12} />
<Skeleton width={48} height={48} rounded="full" />
```

---

### InputGroup

Groups multiple inputs (or an input + button) with connected borders.

```tsx
import { InputGroup } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| children | `ReactNode` | required | Input/button children -- first and last get rounded corners |
| className | `string` | -- | Additional CSS classes |

**When to use:** Search input + button, quantity input + unit select.

```tsx
<InputGroup>
  <Input placeholder="Search..." />
  <Button variant="highlight">Go</Button>
</InputGroup>
```

---

### StepIndicator

A navigation bar for multi-step wizards showing current step, Previous, and Next buttons.

```tsx
import { StepIndicator } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| currentStep | `number` | required | Current step (1-based) |
| totalSteps | `number` | required | Total number of steps |
| onPrev | `() => void` | -- | Previous button handler. Disabled on step 1 |
| onNext | `() => void` | -- | Next button handler |
| prevLabel | `string` | `'Previous'` | Previous button text |
| nextLabel | `string` | auto | Next button text. Defaults to `'Finish'` on last step |
| className | `string` | -- | Additional CSS classes |

**When to use:** Multi-step forms, onboarding flows, wizard UIs.

```tsx
<StepIndicator
  currentStep={2}
  totalSteps={4}
  onPrev={() => setStep(s => s - 1)}
  onNext={() => setStep(s => s + 1)}
/>
```

---

### ConfirmDialog

A pre-built confirmation dialog with confirm/cancel actions.

```tsx
import { ConfirmDialog } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| open | `boolean` | required | Whether the dialog is visible |
| onClose | `() => void` | required | Called when dismissed |
| onConfirm | `() => void` | required | Called when confirmed |
| title | `string` | required | Dialog title |
| description | `string` | -- | Optional body text |
| confirmLabel | `string` | `'Confirm'` | Confirm button text |
| cancelLabel | `string` | `'Cancel'` | Cancel button text |
| variant | `'default' \| 'danger'` | `'default'` | `danger` makes the confirm button red |

**When to use:** Delete confirmations, discard changes, irreversible actions.

```tsx
<ConfirmDialog
  open={showConfirm}
  onClose={() => setShowConfirm(false)}
  onConfirm={handleDelete}
  title="Delete recipe?"
  description="This action cannot be undone."
  variant="danger"
  confirmLabel="Delete"
/>
```

---

## 2. Layout and Navigation

### NavBar

A bottom or top navigation bar with text items.

```tsx
import { NavBar } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| items | `NavItem[]` | required | Array of `{ id: string; label: string }` |
| activeId | `string` | required | Currently active item id |
| onNavigate | `(id: string) => void` | required | Called when an item is tapped |
| className | `string` | -- | Additional CSS classes |

**When to use:** Main app navigation, bottom tab bar.

```tsx
<NavBar
  items={[
    { id: 'recipes', label: 'Recipes' },
    { id: 'timers', label: 'Timers' },
    { id: 'settings', label: 'Settings' },
  ]}
  activeId={currentTab}
  onNavigate={setCurrentTab}
/>
```

---

### NavHeader

A top-bar header with centered title and optional left/right actions.

```tsx
import { NavHeader } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| title | `string` | required | Centered title text (rendered in accent color) |
| left | `ReactNode` | -- | Left-side action (e.g., back button) |
| right | `ReactNode` | -- | Right-side action (e.g., settings icon) |
| className | `string` | -- | Additional CSS classes |

**When to use:** Sub-page headers, detail screens, modal headers.

```tsx
<NavHeader
  title="Recipe Details"
  left={<Button variant="ghost" size="icon" onClick={goBack}><Icon name="arrow-left" /></Button>}
  right={<Button variant="ghost" size="icon"><Icon name="more" /></Button>}
/>
```

---

### Page

The root container for a screen, providing minimum height and bottom padding.

```tsx
import { Page } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| children | `ReactNode` | required | Page content |
| className | `string` | -- | Additional CSS classes |

**When to use:** Wrapping every screen's content.

```tsx
<Page>
  <ScreenHeader title="My Recipes" />
  {/* page content */}
</Page>
```

---

### ScreenHeader

A large title with optional subtitle and action buttons, used at the top of primary screens.

```tsx
import { ScreenHeader } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| title | `string` | required | Large title text (24px) |
| subtitle | `string` | -- | Dimmed subtitle below the title |
| actions | `ReactNode` | -- | Action buttons aligned right |
| className | `string` | -- | Additional CSS classes |

**When to use:** Top of list screens, dashboard pages, main sections.

```tsx
<ScreenHeader
  title="Kitchen"
  subtitle="3 active timers"
  actions={<Button variant="highlight" size="sm">Add Recipe</Button>}
/>
```

---

### SectionHeader

A smaller section title with optional action, used inside pages.

```tsx
import { SectionHeader } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| title | `string` | required | Section title (20px) |
| action | `ReactNode` | -- | Action element aligned right |
| className | `string` | -- | Additional CSS classes |

**When to use:** Separating content sections within a page.

```tsx
<SectionHeader title="Favorites" action={<Button variant="ghost" size="sm">See all</Button>} />
```

---

### SettingsGroup

A labeled group container for settings rows (typically containing ListItem components).

```tsx
import { SettingsGroup } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| label | `string` | required | Group label (dimmed, 13px) |
| children | `ReactNode` | required | Settings rows |
| className | `string` | -- | Additional CSS classes |

**When to use:** Settings pages, preference groups.

```tsx
<SettingsGroup label="Notifications">
  <ListItem title="Push notifications" trailing={<Toggle checked={push} onChange={setPush} />} />
  <ListItem title="Email digest" trailing={<Toggle checked={email} onChange={setEmail} />} />
</SettingsGroup>
```

---

### CategoryFilter

A horizontal scrollable row of category filter buttons.

```tsx
import { CategoryFilter } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| categories | `string[]` | required | List of category labels |
| selected | `string` | required | Currently selected category |
| onSelect | `(category: string) => void` | required | Called when a category is tapped |
| className | `string` | -- | Additional CSS classes |

**When to use:** Filtering lists -- recipe categories, product types, bookmark folders.

```tsx
<CategoryFilter
  categories={['All', 'Italian', 'Mexican', 'Asian', 'Desserts']}
  selected={category}
  onSelect={setCategory}
/>
```

---

### ListItem

A versatile list row with title, subtitle, leading icon, and trailing element.

```tsx
import { ListItem } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| title | `string` | required | Primary text |
| subtitle | `string` | -- | Secondary text below title |
| leading | `ReactNode` | -- | Element before the text (icon, avatar) |
| trailing | `ReactNode` | -- | Element after the text (toggle, badge, chevron) |
| onPress | `() => void` | -- | If provided, renders as a button with hover state |
| className | `string` | -- | Additional CSS classes |

**When to use:** Settings rows, search results, recipe ingredient lists, any vertical list.

```tsx
<ListItem
  title="Dark Mode"
  subtitle="Use dark color scheme"
  leading={<Icon name="moon" />}
  trailing={<Toggle checked={dark} onChange={setDark} />}
/>
```

---

### SearchBar

A search input with a built-in magnifying glass icon.

```tsx
import { SearchBar } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| value | `string` | required | Current search text |
| onChange | `ChangeEventHandler<HTMLInputElement>` | required | Called on text change |
| placeholder | `string` | `'Search...'` | Placeholder text |
| className | `string` | -- | Additional CSS classes |
| ...rest | `InputHTMLAttributes` (minus type) | -- | Native input attributes |

**When to use:** Any list that needs search filtering.

```tsx
<SearchBar value={query} onChange={e => setQuery(e.target.value)} placeholder="Search recipes..." />
```

---

## 3. Feedback and Overlay

### TimerRing

A circular countdown timer with SVG ring animation.

```tsx
import { TimerRing } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| remaining | `number` | required | Seconds remaining |
| total | `number` | required | Total seconds |
| size | `number` | `160` | Diameter in pixels |
| strokeWidth | `number` | `6` | Ring stroke width |
| formatFn | `(seconds: number) => string` | `m:ss` | Custom time formatter |
| className | `string` | -- | Additional CSS classes |

**When to use:** Cooking timers, workout timers, pomodoro clocks.

```tsx
<TimerRing remaining={145} total={300} size={200} />
```

---

### Dialog

A bottom-sheet-style dialog overlay with title, content, and action buttons.

```tsx
import { Dialog } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| open | `boolean` | required | Whether the dialog is visible |
| onClose | `() => void` | required | Called when overlay is clicked or Escape is pressed |
| title | `string` | required | Dialog title (centered) |
| children | `ReactNode` | -- | Body content |
| actions | `DialogAction[]` | -- | Array of `{ label, onClick, variant? }` buttons |
| className | `string` | -- | Additional CSS classes |

`DialogAction` shape: `{ label: string; onClick: () => void; variant?: 'default' | 'danger' }`

**When to use:** Confirmations, action menus, information popups.

```tsx
<Dialog
  open={showDialog}
  onClose={() => setShowDialog(false)}
  title="Share Recipe"
  actions={[
    { label: 'Copy Link', onClick: copyLink },
    { label: 'Cancel', onClick: () => setShowDialog(false) },
  ]}
>
  Share this recipe with friends?
</Dialog>
```

---

### BottomSheet

A generic bottom-sheet container. Unlike Dialog, it has no built-in title or actions -- you control the content entirely.

```tsx
import { BottomSheet } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| open | `boolean` | required | Whether the sheet is visible |
| onClose | `() => void` | required | Called on overlay click or Escape |
| children | `ReactNode` | required | Sheet content |
| className | `string` | -- | Additional CSS classes |

**When to use:** Custom overlays, pickers, complex forms shown as overlays.

```tsx
<BottomSheet open={showSheet} onClose={() => setShowSheet(false)}>
  <div className="p-4">
    <h3>Select Ingredients</h3>
    {/* custom content */}
  </div>
</BottomSheet>
```

---

### Toast

An inline notification bar.

```tsx
import { Toast } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| message | `string` | required | Toast message text |
| variant | `'info' \| 'warning' \| 'error' \| 'undo'` | `'info'` | Visual style |
| action | `ReactNode` | -- | Action element (e.g., an Undo button) |
| className | `string` | -- | Additional CSS classes |

**When to use:** Success messages, warnings, undo prompts.

```tsx
<Toast
  message="Recipe deleted"
  variant="undo"
  action={<Button variant="ghost" size="sm" onClick={undo}>Undo</Button>}
/>
```

---

### EmptyState

A centered placeholder for when a list or section has no content.

```tsx
import { EmptyState } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| icon | `ReactNode` | -- | Optional icon above the title |
| title | `string` | required | Main message |
| description | `string` | -- | Subtitle description |
| action | `{ label: string; onClick: () => void }` | -- | Optional CTA button |
| className | `string` | -- | Additional CSS classes |

**When to use:** Empty lists, no search results, first-time-use prompts.

```tsx
<EmptyState
  title="No recipes yet"
  description="Add your first recipe to get started"
  action={{ label: 'Add Recipe', onClick: openAddRecipe }}
/>
```

---

### Loading

A pixel-art spinning loader using a 4x4 perimeter grid animation.

```tsx
import { Loading } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| size | `number` | `24` | Size in pixels |
| className | `string` | -- | Additional CSS classes |

**When to use:** Inline loading states, button loading, content fetching indicators.

```tsx
<Loading size={32} />
```

---

### CTAGroup

A group of call-to-action buttons in three layout modes.

```tsx
import { CTAGroup } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| actions | `CTAAction[]` | required | Array of action objects |
| layout | `'stacked' \| 'side-by-side' \| 'icon-row'` | `'stacked'` | Layout mode |
| className | `string` | -- | Additional CSS classes |

`CTAAction` shape: `{ label: string; onClick: () => void; variant?: 'default' | 'highlight' | 'danger'; icon?: ReactNode }`

**When to use:** Dialog footers, action sheets, bottom action bars.

```tsx
<CTAGroup
  layout="side-by-side"
  actions={[
    { label: 'Cancel', onClick: onClose },
    { label: 'Save', onClick: onSave, variant: 'highlight' },
  ]}
/>
```

---

## 4. Tags and Indicators

### Tag

A selectable tag button, optionally with an icon.

```tsx
import { Tag } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| label | `string` | required | Tag text |
| icon | `ReactNode` | -- | Optional leading icon |
| selected | `boolean` | -- | Whether the tag is in selected state |
| onPress | `() => void` | -- | Tap handler |
| className | `string` | -- | Additional CSS classes |

**When to use:** Filter tags, multi-select options, keyword labels.

```tsx
<Tag label="Vegan" selected={filters.includes('vegan')} onPress={() => toggleFilter('vegan')} />
```

---

### TagCarousel

A horizontally scrollable container for Tag components.

```tsx
import { TagCarousel } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| children | `ReactNode` | required | Tag children |
| className | `string` | -- | Additional CSS classes |

**When to use:** Wrapping multiple Tags in a horizontally scrollable row.

```tsx
<TagCarousel>
  <Tag label="All" selected />
  <Tag label="Italian" />
  <Tag label="Quick" />
</TagCarousel>
```

---

### TagCard

A larger card-style tag with icon, title, and subtitle (150x150 min).

```tsx
import { TagCard } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| icon | `ReactNode` | -- | Top-left icon |
| title | `string` | required | Card title |
| subtitle | `string` | -- | Card subtitle |
| onPress | `() => void` | -- | Tap handler |
| className | `string` | -- | Additional CSS classes |

**When to use:** Category selection grids, feature cards, quick-action shortcuts.

```tsx
<TagCard icon={<Icon name="timer" />} title="Quick Meals" subtitle="Under 15 min" onPress={() => navigate('/quick')} />
```

---

### SliderIndicator

Dot indicators for a carousel/slider, showing the active dot elongated.

```tsx
import { SliderIndicator } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| count | `number` | required | Total number of dots |
| active | `number` | required | Active dot index (0-based) |
| className | `string` | -- | Additional CSS classes |

**When to use:** Below a horizontal card carousel or image slider.

```tsx
<SliderIndicator count={5} active={currentSlide} />
```

---

### PageIndicator

Full-width segmented progress bars showing the active page.

```tsx
import { PageIndicator } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| count | `number` | required | Total number of pages |
| active | `number` | required | Active page index (0-based) |
| className | `string` | -- | Additional CSS classes |

**When to use:** Onboarding flows, story-style pagination, wizard step indicators.

```tsx
<PageIndicator count={4} active={step} />
```

---

## 5. Chat

### ChatContainer

The main chat layout with a scrollable message list and sticky input area.

```tsx
import { ChatContainer } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| messages | `ChatMessage[]` | required | Array of message objects |
| input | `ReactNode` | -- | Input component pinned to the bottom |
| className | `string` | -- | Additional CSS classes |

`ChatMessage` shape:

```ts
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  thinking?: string;
  isStreaming?: boolean;
  toolCalls?: ToolCall[];
  codeBlocks?: CodeBlock[];
  diff?: string;
  error?: string;
  command?: string;
}
```

**When to use:** AI chat interfaces, copilot UIs, messaging screens.

```tsx
<ChatContainer
  messages={messages}
  input={
    <ChatInput value={input} onChange={setInput} onSend={handleSend} />
  }
/>
```

---

### ChatBubble

Renders a single chat message with role-appropriate styling and inline rendering of thinking blocks, code, diffs, tool calls, errors, and commands.

```tsx
import { ChatBubble } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| message | `ChatMessage` | required | The message object |
| className | `string` | -- | Additional CSS classes |

**When to use:** Custom chat layouts where you need individual bubble control.

---

### ChatInput

A multi-line auto-growing text input with a send button. Sends on Enter (Shift+Enter for newline).

```tsx
import { ChatInput } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| value | `string` | required | Current input text |
| onChange | `(value: string) => void` | required | Text change handler |
| onSend | `() => void` | required | Send handler |
| placeholder | `string` | `'Type a message...'` | Input placeholder |
| disabled | `boolean` | -- | Disables input and send |
| className | `string` | -- | Additional CSS classes |

---

### ChatThinking

A collapsible "Thinking..." block showing the AI's reasoning.

```tsx
import { ChatThinking } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| content | `string` | required | Thinking text content |
| className | `string` | -- | Additional CSS classes |

---

### ChatCodeBlock

A syntax-highlighted code block with line numbers and optional language label.

```tsx
import { ChatCodeBlock } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| language | `string` | -- | Language label displayed above the code |
| content | `string` | required | Code content |
| className | `string` | -- | Additional CSS classes |

---

### ChatDiff

Renders a unified diff with color-coded +/- lines.

```tsx
import { ChatDiff } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| content | `string` | required | Diff text (unified format) |
| className | `string` | -- | Additional CSS classes |

---

### ChatToolCall

A collapsible tool call indicator showing name, status, input, and output.

```tsx
import { ChatToolCall } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| toolCall | `ToolCall` | required | `{ name, input?, output?, status? }` |
| className | `string` | -- | Additional CSS classes |

`ToolCall.status`: `'running' | 'complete' | 'error'` (or undefined)

---

### ChatCommand

Displays a terminal command (prefixed with `$`) and its optional output.

```tsx
import { ChatCommand } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| command | `string` | required | The command text |
| output | `string` | -- | Command output |
| className | `string` | -- | Additional CSS classes |

---

### ChatError

An inline error message block.

```tsx
import { ChatError } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| message | `string` | required | Error message text |
| className | `string` | -- | Additional CSS classes |

---

## 6. Calendar

### Calendar

A full-featured calendar with month, week, and day views. Can be controlled or uncontrolled.

```tsx
import { Calendar } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| events | `CalendarEvent[]` | `[]` | Events to display |
| view | `'month' \| 'week' \| 'day'` | uncontrolled (`'month'`) | Current view mode |
| onViewChange | `(v: CalendarView) => void` | -- | View change handler (controlled mode) |
| selectedDate | `Date` | uncontrolled (`new Date()`) | Current date |
| onDateChange | `(d: Date) => void` | -- | Date change handler (controlled mode) |
| onEventClick | `(e: CalendarEvent) => void` | -- | Called when an event is clicked |
| className | `string` | -- | Additional CSS classes |

`CalendarEvent` shape:

```ts
interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  color?: string;
  location?: string;
  description?: string;
}
```

**When to use:** Scheduling UIs, meal planning, event management.

```tsx
<Calendar
  events={mealEvents}
  onEventClick={(e) => openMealDetail(e.id)}
/>
```

---

## 7. Charts

### Sparkline

A minimal inline line chart, no axes or labels.

```tsx
import { Sparkline } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| data | `number[]` | required | Array of numeric values (min 2) |
| width | `number` | `80` | SVG width |
| height | `number` | `24` | SVG height |
| color | `string` | accent color | Line color |
| className | `string` | -- | Additional CSS classes |

**When to use:** Inline trends in stat cards, table cells, list items.

```tsx
<Sparkline data={[10, 15, 12, 20, 18, 25]} width={80} height={24} />
```

---

### LineChart

A line chart with optional grid, labels, area fill, and animation.

```tsx
import { LineChart } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| data | `LineChartPoint[]` | required | Array of `{ x: number; y: number; label?: string }` |
| width | `number` | `300` | SVG width |
| height | `number` | `200` | SVG height |
| color | `string` | accent color | Line and dot color |
| showGrid | `boolean` | `true` | Show horizontal grid lines |
| showLabels | `boolean` | `true` | Show axis labels |
| showArea | `boolean` | `false` | Fill area under the line |
| animated | `boolean` | `false` | Animate the line drawing |
| className | `string` | -- | Additional CSS classes |

**When to use:** Trends over time, price history, performance graphs.

```tsx
<LineChart
  data={[
    { x: 1, y: 10 },
    { x: 2, y: 25 },
    { x: 3, y: 18 },
    { x: 4, y: 32 },
  ]}
  showArea
/>
```

---

### BarChart

A vertical bar chart with optional labels.

```tsx
import { BarChart } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| data | `BarChartItem[]` | required | Array of `{ label: string; value: number; color?: string }` |
| width | `number` | `300` | SVG width |
| height | `number` | `200` | SVG height |
| color | `string` | accent color | Default bar color |
| horizontal | `boolean` | `false` | (Reserved for future horizontal layout) |
| showLabels | `boolean` | `true` | Show bottom labels |
| className | `string` | -- | Additional CSS classes |

**When to use:** Category comparisons, weekly activity, ingredient distribution.

```tsx
<BarChart
  data={[
    { label: 'Mon', value: 3 },
    { label: 'Tue', value: 7 },
    { label: 'Wed', value: 5 },
  ]}
/>
```

---

### PieChart

A pie or donut chart with auto-generated legend.

```tsx
import { PieChart } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| data | `PieChartItem[]` | required | Array of `{ label: string; value: number; color?: string }` |
| size | `number` | `160` | Chart diameter |
| donut | `boolean` | `false` | Render as donut chart |
| centerLabel | `string` | -- | Text in center of donut |
| className | `string` | -- | Additional CSS classes |

**When to use:** Proportional breakdowns, macro nutrients, budget allocation.

```tsx
<PieChart
  data={[
    { label: 'Protein', value: 30 },
    { label: 'Carbs', value: 50 },
    { label: 'Fat', value: 20 },
  ]}
  donut
  centerLabel="Macros"
/>
```

---

### StatCard

A dashboard stat card with value, change indicator, trend, and optional sparkline.

```tsx
import { StatCard } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| label | `string` | required | Stat label |
| value | `string \| number` | required | Main value display |
| change | `string` | -- | Change text (e.g., "+12%") |
| trend | `'up' \| 'down' \| 'neutral'` | -- | Trend direction (colors the change text) |
| sparklineData | `number[]` | -- | Data for inline sparkline |
| className | `string` | -- | Additional CSS classes |

**When to use:** Dashboard KPIs, summary statistics, performance metrics.

```tsx
<StatCard label="Recipes Cooked" value={42} change="+8%" trend="up" sparklineData={[30, 35, 32, 38, 42]} />
```

---

## 8. Data Visualization

### Timeline

A vertical timeline with colored dots, titles, subtitles, and timestamps.

```tsx
import { Timeline } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| events | `TimelineEvent[]` | required | Array of timeline events |
| className | `string` | -- | Additional CSS classes |

`TimelineEvent` shape:

```ts
interface TimelineEvent {
  id: string;
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color?: string;
}
```

**When to use:** Activity feeds, order tracking, cooking step history.

```tsx
<Timeline events={[
  { id: '1', title: 'Recipe created', timestamp: '2:30 PM', color: 'var(--color-positive)' },
  { id: '2', title: 'Ingredients added', subtitle: '12 items', timestamp: '2:35 PM' },
  { id: '3', title: 'Timer started', timestamp: '2:40 PM' },
]} />
```

---

### StatGrid

A grid of stat boxes with large accent-colored values.

```tsx
import { StatGrid } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| stats | `StatItem[]` | required | Array of `{ label: string; value: string \| number; detail?: string }` |
| columns | `2 \| 3 \| 4` | `3` | Number of grid columns |
| className | `string` | -- | Additional CSS classes |

**When to use:** Dashboard summaries, recipe nutrition facts, quick stats overview.

```tsx
<StatGrid
  columns={3}
  stats={[
    { label: 'Calories', value: '450', detail: 'per serving' },
    { label: 'Prep', value: '15m' },
    { label: 'Servings', value: 4 },
  ]}
/>
```

---

### StatusProgress

A multi-step progress bar with labeled segments and statuses.

```tsx
import { StatusProgress } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| steps | `StatusProgressStep[]` | required | Array of `{ label: string; status: StepStatus }` |
| className | `string` | -- | Additional CSS classes |

`StepStatus`: `'waiting' | 'in-progress' | 'complete' | 'skipped'`

**When to use:** Order tracking, recipe progress, multi-stage workflows.

```tsx
<StatusProgress steps={[
  { label: 'Prep', status: 'complete' },
  { label: 'Cook', status: 'in-progress' },
  { label: 'Rest', status: 'waiting' },
  { label: 'Serve', status: 'waiting' },
]} />
```

---

## 9. Media and Input

### FileUpload

A drag-and-drop file upload zone with file list display.

```tsx
import { FileUpload } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| onFiles | `(files: File[]) => void` | required | Called with selected files |
| accept | `string` | -- | Accepted MIME types (e.g., `'image/*'`) |
| multiple | `boolean` | `false` | Allow multiple files |
| maxSize | `number` | -- | Maximum file size in bytes |
| label | `string` | `'Drop files or tap to browse'` | Zone label |
| className | `string` | -- | Additional CSS classes |

**When to use:** Image uploads, recipe photo import, document attachments.

```tsx
<FileUpload accept="image/*" multiple maxSize={5 * 1024 * 1024} onFiles={handleFiles} />
```

---

### VoiceInput

A microphone button with speech recognition, waveform animation, and transcript display.

```tsx
import { VoiceInput } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| onTranscript | `(text: string) => void` | required | Called with recognized text |
| onAudioBlob | `(blob: Blob) => void` | -- | Called with raw audio data |
| language | `string` | `'en-US'` | Speech recognition language |
| className | `string` | -- | Additional CSS classes |

**When to use:** Voice search, dictation input, accessibility feature.

```tsx
<VoiceInput onTranscript={(text) => setSearchQuery(text)} />
```

---

### WaveformVisualizer

Animated waveform bars indicating active audio input.

```tsx
import { WaveformVisualizer } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| active | `boolean` | required | Whether the animation is running |
| barCount | `number` | `5` | Number of bars |
| color | `string` | accent color | Bar color |
| className | `string` | -- | Additional CSS classes |

**When to use:** Audio recording indicators, voice input feedback.

```tsx
<WaveformVisualizer active={isRecording} barCount={7} />
```

---

### ImageGrid

A responsive grid of image thumbnails.

```tsx
import { ImageGrid } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| images | `ImageItem[]` | required | Array of `{ src: string; alt?: string; thumbnail?: string }` |
| columns | `2 \| 3 \| 4` | `3` | Number of grid columns |
| onSelect | `(index: number) => void` | -- | Called when an image is tapped |
| className | `string` | -- | Additional CSS classes |

**When to use:** Photo galleries, recipe step images, product image grids.

```tsx
<ImageGrid
  images={photos}
  columns={3}
  onSelect={(i) => setViewerIndex(i)}
/>
```

---

### ImageViewer

A full-screen lightbox for viewing images with keyboard navigation.

```tsx
import { ImageViewer } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| images | `ImageItem[]` | required | Array of image objects |
| currentIndex | `number` | required | Currently viewed image index |
| onClose | `() => void` | required | Close handler |
| onNavigate | `(index: number) => void` | required | Navigation handler |
| className | `string` | -- | Additional CSS classes |

**When to use:** Full-screen photo viewer, paired with ImageGrid.

```tsx
{viewerIndex !== null && (
  <ImageViewer
    images={photos}
    currentIndex={viewerIndex}
    onClose={() => setViewerIndex(null)}
    onNavigate={setViewerIndex}
  />
)}
```

---

### AudioPlayer

A compact audio player with play/pause, progress bar, and time display.

```tsx
import { AudioPlayer } from 'even-toolkit/web';
```

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| src | `string` | required | Audio file URL |
| title | `string` | -- | Track title |
| className | `string` | -- | Additional CSS classes |

**When to use:** Audio instructions, podcast snippets, voice notes.

```tsx
<AudioPlayer src="/audio/cooking-tip.mp3" title="Chef's Tip: Perfect Risotto" />
```
