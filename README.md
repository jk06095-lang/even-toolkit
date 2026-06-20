# even-toolkit

## My role

- Product concept and UX architecture for Project ECHO
- G2 HUD interaction design for glanceable English practice
- TypeScript implementation of the ECHO companion app
- Audio/VAD integration for G2 and phone microphone modes
- AI cue policy, proxy-first API boundary, and local fallback design
- Hardware usability testing plan and release-safety checks

## Project ECHO Proxy

Project ECHO uses a server-side API proxy for cue generation, transcription,
and session analysis. See [docs/echo-api-proxy.md](./docs/echo-api-proxy.md)
for deployment environment variables, key-rotation requirements, and release
artifact checks.
The browser app may build with `VITE_ECHO_API_BASE_URL`, but the short-lived
ECHO session token must be injected at runtime, not bundled as a `VITE_*`
secret. `even-app/src/services/echo-api.ts` reads
`globalThis.__PROJECT_ECHO_SESSION_TOKEN__` first, then
`sessionStorage["projectEcho.sessionToken"]`, and sends the value as
`Authorization: Bearer <token>` only for the current WebView session.

## Project ECHO Evidence

Real-device validation is tracked in [RESEARCH.md](./RESEARCH.md) and
[HARDWARE_QA.md](./HARDWARE_QA.md). Portfolio claims should link to the
completed G2 case study and video evidence only after the pilot scorecard is
filled in.

Run `npm run verify:all` before release or hardware QA. It verifies exact Even
SDK/tooling dependency pins, the root TypeScript build, the Project ECHO
ChatGPT Action contract plus local mock smoke tests, pilot/VAD and hardware QA
evidence templates, ECHO API proxy smoke tests, and ECHO app
test/build/bundle/package gate. Final pilot
manifests should pass
`npm run validate:pilot-evidence -- docs/project-echo-pilot-evidence.completed.json`
and final hardware QA manifests should pass
`npm run validate:hardware-qa -- docs/project-echo-hardware-qa.completed.json`
before README portfolio links are updated. The pilot manifest must include the
core outcome metrics from the plan: Conversation Recovery Rate with an 8-second
window, Day 1/Day 7 Independent Transfer Rate, transfer scenario count, and a
real evidence reference. It must also identify the repo-local `.ehpk` package
path and SHA-256 digest used for the pilot, and that digest must match the
actual package file before the manifest can pass. The Custom GPT Action evidence
manifest should pass
`npm run validate:chatgpt-action-evidence -- docs/project-echo-chatgpt-action-evidence.completed.json`
after the Action API is deployed, OAuth is configured, privacy rejection tests
are captured, and calibrated G2/audio-level active-recall pronunciation evidence
exists.
It also has to prove the spaced-recall boundary: two separate hidden recall
days, transfer scenario evidence, and same-day repeat attempts not counting as
transfer. Final #29 evidence must include the structured recall dates, attempt
refs, transfer scenario IDs, and G2 bridge audio-level frame metrics rather
than only marking those checks as `true`. It must also identify the repo-local
`.ehpk` package path and matching SHA-256 digest used for G2 active-recall
evidence, and confirm that it is the same artifact used for hardware QA.
The hardware QA manifest must identify the exact repo-local `.ehpk` package
path and matching SHA-256 digest used for the real G2 run, and must include
private/beta locked-phone background lifecycle evidence, Android cold-start
rebuild evidence, foreground audio-capture re-enable evidence, WebSocket
reconnect handling or explicit non-use evidence, root-page system-exit dialog
evidence, permission-denial path evidence, console sanity evidence,
phone-only conversation timeline evidence for the G2 Mic, Phone Mic, and import
flows plus G2 HUD evidence for `READY`, `LISTENING`, `CUE`, `ACK`, and
`PAUSED`.
GitHub Actions runs the same gate from
[.github/workflows/verify.yml](./.github/workflows/verify.yml). A reference copy
is also kept at [docs/github-actions-verify.yml](./docs/github-actions-verify.yml).

Run `npm run readiness:echo` when preparing to close the remaining Project ECHO
issues. It intentionally fails until the completed pilot manifest, completed
hardware QA manifest, completed ChatGPT Action evidence manifest for #29,
deployed proxy smoke check for #1/#27, key-rotation and session-token evidence
for #1/#27, and final README case-study/video links are all present. For the
proxy smoke check, set `ECHO_PROXY_BASE_URL`, `ECHO_PROXY_SMOKE_ORIGIN`,
`ECHO_PROXY_SMOKE_SESSION_TOKEN`, and repo-local
`ECHO_PROXY_SMOKE_EVIDENCE_OUT` such as `docs/proxy-smoke-evidence.json`; the
readiness command passes that evidence path to the proxy smoke runner from the
`echo-api-proxy` working directory. Use
[docs/key-rotation-evidence.template.md](./docs/key-rotation-evidence.template.md)
as the key-rotation evidence template; `npm run readiness:echo` validates the
filled evidence with `npm run validate:key-rotation-evidence`, including the ISO
rotation date, current ECHO app package version, and checked-in deploy-smoke JSON
evidence for signed-token, idempotency, and closed circuit-breaker behavior.
Final portfolio links must be markdown links carrying the markers
`project-echo-case-study-ko`,
`project-echo-case-study-en`, and `project-echo-real-g2-video`, and they must
match the completed pilot manifest targets. Repo-path targets on those README
links must point to files that already exist in the repository.
For a compact issue-to-evidence handoff before field work, see
[docs/project-echo-readiness-handoff.md](./docs/project-echo-readiness-handoff.md).

Before a field run, generate draft evidence manifests and the key-rotation
evidence draft with:

```bash
npm run prepare:echo-evidence-drafts
```

To inspect which final evidence gates are still missing without promoting any
draft artifact, run:

```bash
npm run status:echo-evidence
```

The drafts are written under `docs/evidence-drafts/` and fill only local facts
such as the current ECHO app version, `.ehpk` SHA-256, bundle metrics when
available, local client artifact scan counts, and draft case-study/video
package outlines. The generator also writes
`docs/evidence-drafts/project-echo-field-runbook.draft.md`, a single operator
checklist mapping the remaining issues to their final evidence gates and the
Even Hub private/beta testing boundary. They stay in `draft` status and do not
replace the required `*.completed.json` evidence files, the final
`docs/key-rotation-evidence.md`, or the final README portfolio links.
After production proxy or Action OAuth smoke JSON exists, rerun the draft helper
with `--proxy-smoke-evidence docs/proxy-smoke-evidence.json` and/or
`--action-oauth-smoke docs/chatgpt-action-oauth-smoke.json` to prefill only the
corresponding draft fields while keeping the manifests in draft status.

For the future Custom GPT Action API, run the local reference smoke with:

```bash
npm run test:chatgpt-action-mock
```

This starts a loopback-only mock implementation of the OpenAPI endpoints and
checks bounded OAuth-style reads/writes plus privacy rejections. It is useful
before deployment, but it is not final #29 evidence until a real OAuth-backed
Action API is deployed and connected to a Custom GPT with G2/audio-level recall
proof.

After the completed pilot manifest and final portfolio assets exist, promote the
README portfolio links with:

```bash
npm run promote:echo-portfolio-links
```

The promotion command validates `docs/project-echo-pilot-evidence.completed.json`,
sets its `caseStudy.readmeLinksUpdated` flag, and inserts README markdown links
that exactly match the completed manifest targets.

The readiness gate is aligned with the
[official Even Realities developer docs](https://hub.evenrealities.com/docs/get-started/overview):
Even Hub apps run as phone-hosted WebView plugins, G2 hardware is the display
and input surface, production network access must be limited to whitelisted
origins with working CORS, and released `.ehpk` bundles must not contain API
keys or secrets. The manifest check also enforces the current official package
shape (`edition: 202601`, `min_sdk_version: 0.0.10`, permission objects with
human-readable descriptions, and supported language codes). Project ECHO's
manifest declares both `en` and `ko` because the app uses English practice
flows plus Korean timeline translation, learner-profile, tutor, and portfolio
evidence surfaces.

## Built with

- Even Hub SDK
- even-toolkit, MIT License
- Original toolkit foundations credited in [CREDITS.md](./CREDITS.md)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support-yellow?style=flat&logo=buy-me-a-coffee)](https://buymeacoffee.com/f3tch)

Design system & component library for **Even Realities G2** smart glasses apps.

55+ web components, 191 pixel-art icons, glasses SDK bridge with per-screen architecture, speech-to-text module, light/dark themes, and design tokens — all following the Even Realities 2025 UIUX Design Guidelines.

**[Live Demo → even-demo.vercel.app](https://even-demo.vercel.app)**

## Install

```bash
npm install even-toolkit
```

Scaffold a new app instantly:

```bash
npx @even-toolkit/create-even-app my-app
# or
npx even-toolkit my-app
```

Choose from 6 templates: minimal, dashboard, notes, chat, tracker, media.

## What's Inside

### `/web` — Web Component Library

55+ React components with Tailwind CSS, designed for mobile-first companion apps.

```tsx
import { Button, Card, NavBar, ListItem, Toggle, AppShell } from 'even-toolkit/web';
```

**Primitives:** Button, Card, Badge, Input, Textarea, Select, MultiSelect, Checkbox, RadioGroup, Slider, InputGroup, Skeleton, Progress, StatusDot, Pill, Toggle, SegmentedControl, Table, Kbd, Divider

**Layout:** AppShell, Page, NavBar, NavHeader, SideDrawer, DrawerShell, DrawerTrigger, ScreenHeader, SectionHeader, SettingsGroup, CategoryFilter, ListItem (swipe-to-delete), SearchBar, Tag, TagCarousel, TagCard, PagedCarousel, CardCarousel, SliderIndicator, PageIndicator, StepIndicator, Timeline, StatGrid, StatusProgress

**Feedback:** TimerRing, Dialog, ConfirmDialog, Toast, EmptyState, Loading, BottomSheet, CTAGroup, ScrollPicker, DatePicker, TimePicker, SelectionPicker

**Charts (recharts):** Sparkline, LineChart, BarChart, PieChart, StatCard

**Media:** ChatContainer, ChatInput, Calendar, FileUpload, VoiceInput, ImageGrid, ImageViewer, AudioPlayer

### `/web/icons` — 191 Pixel-Art Icons

Official Even Realities icon set: 32x32 grid, 2x2px units, 6 categories.

```tsx
import { IcChevronBack, IcTrash, IcSettings } from 'even-toolkit/web/icons/svg-icons';

<IcChevronBack width={20} height={20} />
```

**Categories:** Edit & Settings (32), Feature & Function (50), Guide System (20), Menu Bar (8), Navigate (23), Status (54), Health (12)

---

## Glasses SDK

Everything needed to build G2 glasses apps with a clean, per-screen architecture.

### Per-Screen Architecture (v1.4)

Each glasses screen lives in its own file with co-located display + action logic:

```
src/glass/
  shared.ts              — Snapshot type + actions interface
  selectors.ts           — Screen router (3 lines of wiring)
  splash.ts              — Splash image + loading text
  AppGlasses.tsx         — useGlasses hook setup
  screens/
    home.ts              — { display, action }
    detail.ts            — { display, action }
    active.ts            — { display, action }
```

#### Define a screen

```ts
import type { GlassScreen } from 'even-toolkit/glass-screen-router';
import { buildScrollableList } from 'even-toolkit/glass-display-builders';
import { moveHighlight } from 'even-toolkit/glass-nav';

export const homeScreen: GlassScreen<MySnapshot, MyActions> = {
  display(snapshot, nav) {
    return {
      lines: buildScrollableList({
        items: snapshot.items,
        highlightedIndex: nav.highlightedIndex,
        maxVisible: 5,
        formatter: (item) => item.title,
      }),
    };
  },

  action(action, nav, snapshot, ctx) {
    if (action.type === 'HIGHLIGHT_MOVE') {
      return { ...nav, highlightedIndex: moveHighlight(nav.highlightedIndex, action.direction, snapshot.items.length - 1) };
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      ctx.navigate(`/item/${snapshot.items[nav.highlightedIndex].id}`);
      return nav;
    }
    return nav;
  },
};
```

#### Wire screens together

```ts
import { createGlassScreenRouter } from 'even-toolkit/glass-screen-router';
import { homeScreen } from './screens/home';
import { detailScreen } from './screens/detail';

export const { toDisplayData, onGlassAction } = createGlassScreenRouter({
  'home': homeScreen,
  'detail': detailScreen,
}, 'home');
```

### Navigation Helpers (`glass-nav`)

```ts
import { moveHighlight, clampIndex, calcMaxScroll, wrapIndex } from 'even-toolkit/glass-nav';

// Clamped movement (0 to max)
moveHighlight(current, 'up', max)    // Math.max(0, Math.min(max, current - 1))
moveHighlight(current, 'down', max)  // Math.max(0, Math.min(max, current + 1))

// Clamp index to button count
clampIndex(index, buttonCount)       // Math.min(Math.max(0, index), count - 1)

// Max scroll offset
calcMaxScroll(totalLines, slots)     // Math.max(0, totalLines - slots)

// Wrapping movement (loops around)
wrapIndex(current, 'down', count)    // (current + 1) % count
```

### Display Builders (`glass-display-builders`)

```ts
import {
  buildScrollableList,
  buildScrollableContent,
  slidingWindowStart,
  G2_TEXT_LINES,          // 10
  DEFAULT_CONTENT_SLOTS,  // 7 (below glassHeader)
} from 'even-toolkit/glass-display-builders';

// Scrollable highlighted list with scroll indicators
const lines = buildScrollableList({
  items: recipes,
  highlightedIndex: nav.highlightedIndex,
  maxVisible: 5,
  formatter: (r) => r.title,
});

// Header + scrollable content with indicators
const display = buildScrollableContent({
  title: 'Recipe Detail',
  actionBar: buildStaticActionBar(['Start'], 0),
  contentLines: ['Line 1', 'Line 2', ...],
  scrollPos: nav.highlightedIndex,
});
```

### Mode Encoding (`glass-mode`)

Pack multiple navigation modes into a single `highlightedIndex`:

```ts
import { createModeEncoder } from 'even-toolkit/glass-mode';

const mode = createModeEncoder({
  buttons: 0,    // 0-99: button selection
  scroll: 100,   // 100+: scroll mode (offset = index - 100)
  links: 200,    // 200+: link navigation
});

mode.getMode(150)    // 'scroll'
mode.getOffset(150)  // 50
mode.encode('scroll', 25)  // 125
```

### Route Mapping (`glass-router`)

```ts
import { createScreenMapper, createIdExtractor, getHomeTiles } from 'even-toolkit/glass-router';

const deriveScreen = createScreenMapper([
  { pattern: '/', screen: 'home' },
  { pattern: /^\/item\/[^/]+$/, screen: 'detail' },
], 'home');

const extractId = createIdExtractor(/^\/item\/([^/]+)/);
const homeTiles = getHomeTiles(appSplash);
```

### Core Glasses Modules

```ts
import { useGlasses } from 'even-toolkit/useGlasses';
import { useFlashPhase } from 'even-toolkit/useFlashPhase';
import { EvenHubBridge } from 'even-toolkit/bridge';
import { line, separator, glassHeader } from 'even-toolkit/types';
import { buildActionBar, buildStaticActionBar } from 'even-toolkit/action-bar';
import { truncate, applyScrollIndicators } from 'even-toolkit/text-utils';
import { renderTimerLines } from 'even-toolkit/timer-display';
import { formatGlassHeader, formatGlassListRow } from 'even-toolkit/glass-format';
import { renderChatBlocks, renderChatReadMode } from 'even-toolkit/glass-chat-display';
import { createSplash, TILE_PRESETS } from 'even-toolkit/splash';
```

**Display:** 576x288px, 10 text lines, text/columns/chart/home page modes, image tiles (max 288x144)

**Input:** action-map (tap/double-tap/scroll events), gestures (debounce + post-tap scroll suppression), keyboard bindings

**Utilities:** splash screens, PNG encoding, text cleaning, pagination, keep-alive, chat block formatters, reusable glass text formatting helpers

---

## Speech-to-Text (STT)

Provider-agnostic speech-to-text module for voice input in G2 glasses apps.

### Providers

| Provider | Type | Streaming | Requires |
|----------|------|-----------|----------|
| `soniox` | Cloud (Soniox) | Yes (real-time) | API key |

### Production Even Hub Pattern

Production Even Hub apps should send audio to a server-side STT/AI proxy that
you control. The phone WebView should hold only a short-lived session token, not
the upstream provider key. Add the proxy origin to `app.json` `network.whitelist`
and configure real CORS on the proxy; the whitelist is not a CORS bypass. The
official packaging and submission docs also state that API keys must never be
bundled into a released `.ehpk`. Do not build a session token into `VITE_*`
variables; inject it into the WebView at launch time and clear it at session end.

```ts
const STT_PROXY_URL = import.meta.env.VITE_STT_PROXY_URL;

export async function transcribeViaProxy(
  audioBase64: string,
  sessionToken: string,
): Promise<string> {
  const response = await fetch(`${STT_PROXY_URL}/v1/transcribe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({
      schemaVersion: '1.0.0',
      audioBase64,
      mimeType: 'audio/pcm;rate=16000',
      task: 'transcribe',
    }),
  });

  if (!response.ok) throw new Error('STT proxy request failed');
  const payload = await response.json() as { text?: string };
  return payload.text ?? '';
}
```

### Local Development Direct Provider

Direct provider keys are supported for local toolkit experiments only. Never ship
this pattern in an Even Hub build, never store provider tokens in `VITE_*`
variables, and never package them into `dist` or `.ehpk` artifacts.

```tsx
import { useSTT } from 'even-toolkit/stt/react';

function VoiceInput() {
  const { transcript, isListening, start, stop } = useSTT({
    provider: 'soniox',
    language: 'en-US',
    apiKey: 'your-soniox-key', // Local development only.
  });

  return (
    <div>
      <button onClick={isListening ? stop : start}>
        {isListening ? 'Stop' : 'Record'}
      </button>
      <p>{transcript}</p>
    </div>
  );
}
```

### Direct Provider Configuration

```tsx
useSTT({
  provider: 'soniox',
  language: 'en-US',        // BCP-47 language tag
  apiKey: 'your-key',       // Local development only; never ship in Even Hub
  vad: { silenceMs: 2500 }, // Auto-stop after silence
  chunkIntervalMs: 4000,    // Progressive transcription interval
  continuous: false,         // Don't auto-stop on silence
})
```

### Audio Sources

Project ECHO keeps audio source selection explicit:
- **G2 Mic** via the G2 bridge (`audioControl`) and bridge-only transcription
- **Phone Mic** only after explicit user selection
- Custom `AudioSource` for your own integration

The G2 path does not silently open Web Speech or the phone microphone.

---

## SDK 0.0.9 Support

- Max image size: 288x144
- IMU control: `bridge.imuEnable()` / `bridge.imuDisable()`
- Launch source detection: `LaunchSource` type
- Fixed `borderRadius` spelling

## Design Tokens

Light theme following Even Realities 2025 guidelines:

```css
@import "even-toolkit/web/theme-light.css";
@import "even-toolkit/web/typography.css";
@import "even-toolkit/web/utilities.css";
```

| Token | Value | Usage |
|-------|-------|-------|
| `--color-text` | #232323 | Primary text (TC-1st) |
| `--color-text-dim` | #7B7B7B | Secondary text (TC-2nd) |
| `--color-bg` | #EEEEEE | Page background (BC-3rd) |
| `--color-surface` | #FFFFFF | Card/component background (BC-1st) |
| `--color-accent` | #232323 | Accent/highlight (BC-Highlight) |
| `--color-positive` | #4BB956 | Success/connected (TC-Green) |
| `--color-negative` | #FF453A | Error/warning (TC-Red) |
| `--color-accent-warning` | #FEF991 | Active/toast (BC-Accent) |
| `--radius-default` | 6px | Default border radius |
| `--font-display` | FK Grotesk Neue | Display & body font |

## Typography

| Style | Size | Weight | Tracking |
|-------|------|--------|----------|
| Very Large Title | 24px | 400 | -0.72px |
| Large Title | 20px | 400 | -0.6px |
| Medium Title | 17px | 400 | -0.17px |
| Medium Body | 17px | 300 | -0.17px |
| Normal Title | 15px | 400 | -0.15px |
| Normal Body | 15px | 300 | -0.15px |
| Normal Subtitle | 13px | 400 | -0.13px |
| Normal Detail | 11px | 400 | -0.11px |

## Navigation Patterns

### DrawerShell (recommended)

Side drawer navigation with automatic hamburger/back-button detection, header context for nested screens, and `bottomItems` for pinned items like Settings.

```tsx
import { DrawerShell, useDrawerHeader } from 'even-toolkit/web';
import type { SideDrawerItem } from 'even-toolkit/web';

// In your shell/layout:
const MENU_ITEMS: SideDrawerItem[] = [
  { id: '/', label: 'Home', section: 'App' },
];
const BOTTOM_ITEMS: SideDrawerItem[] = [
  { id: '/settings', label: 'Settings', section: 'App' },
];

function Shell() {
  return (
    <DrawerShell
      items={MENU_ITEMS}
      bottomItems={BOTTOM_ITEMS}
      title="MyApp"
      getPageTitle={(p) => p === '/' ? 'MyApp' : 'Page'}
      deriveActiveId={(p) => p}
    />
  );
}

// In nested screens — customize the header:
function DetailScreen() {
  useDrawerHeader({
    title: 'Detail',
    backTo: '/',                        // shows back button instead of hamburger
    right: <Button size="sm">Save</Button>,
    below: <Progress value={50} />,     // below header (progress bars)
    footer: <StepIndicator ... />,      // fixed bottom area
    hidden: true,                       // hide header entirely
  });
  return <div>...</div>;
}
```

### NavBar + AppShell (tab bar)

Horizontal tab bar for simpler apps.

```tsx
import { AppShell, NavBar, ScreenHeader, Button, Card } from 'even-toolkit/web';
import type { NavItem } from 'even-toolkit/web';

const tabs: NavItem[] = [
  { id: 'home', label: 'Home' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [tab, setTab] = useState('home');
  return (
    <AppShell header={<NavBar items={tabs} activeId={tab} onNavigate={setTab} />}>
      <div className="px-3 pt-4 pb-8">
        <ScreenHeader title="My App" />
        <Card>Hello from Even Toolkit</Card>
      </div>
    </AppShell>
  );
}
```

```css
@import "tailwindcss";
@import "even-toolkit/web/theme-light.css";
@import "even-toolkit/web/typography.css";
@import "even-toolkit/web/utilities.css";
```

## Apps Built With Even Toolkit

| App | Description | Live |
|-----|-------------|------|
| **EvenDemo** | Component showcase & design system reference | [even-demo.vercel.app](https://even-demo.vercel.app) |
| **EvenMarket** | Real-time stock market data on G2 glasses | [even-market.vercel.app](https://even-market.vercel.app) |
| **EvenKitchen** | Recipe management & step-by-step cooking | [even-kitchen.vercel.app](https://even-kitchen.vercel.app) |
| **EvenWorkout** | Workout tracking with rest timers | [even-workout.vercel.app](https://even-workout.vercel.app) |
| **EvenBrowser** | Text-based web browsing on G2 glasses | [even-browser.vercel.app](https://even-browser.vercel.app) |

## Support

If you find this useful, consider supporting the project:

[![Buy Me A Coffee](https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png)](https://buymeacoffee.com/f3tch)

## License

MIT
