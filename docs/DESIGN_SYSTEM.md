# BOAR design system

TL;DR
- Import primitives from `src/ui/components` and tokens from `useTheme()` / `useTokens()`. No hex, no `fontSize`, no emoji icons in screens.
- Direction: **"Fogueira & Luar"**, the user's identity (Claude Design, `review/ui-ref/`). Fogueira = ember on charcoal (default), Luar = amber on night blue. Dark is the default mode; light variants exist. Baloo 2 for titles and actions, Lexend for reading. The mascot is the signature.
- Palette: **Fogueira / Luar**. Appearance: **system / light / dark**. The three old dark themes (Ocean, Amber, Matrix) are gone.
- **Accessibility floors win over the mockup**: 12pt minimum text (the mockup uses 9–11px labels), 44/48 targets (mockup controls are 40–42px), AA contrast (light variants are adjusted, §2). Use the mockup's layout and components, **not its copy**: its texts ("Verified", "Runs Great", "Under 12GB Limit", fixed tiers) break the honesty rule. Only measured or computed numbers.
- Every interactive primitive already sets role, label, state and a 44pt (iOS) / 48dp (Android) target. Don't re-wrap them in another `Pressable`.
- Gate before a UI PR: `npx tsc --noEmit`, `npx vitest run <affected files>`, Prism's `ui-lint.mjs` shows no regression in touched files, screenshots light + dark + 200% text.

```ts
import { Screen, Section, ListRow, Switch, Button, Text, useToast } from "../ui/components"; // path relative to your file
import { useTheme, useTokens } from "../ui/theme";

const t = useTokens();              // t.color.*, t.space.*, t.radius.*, t.type.*, t.size.*, t.motion.*
const { scheme, reduceMotion } = useTheme();
```

Dev catalog: in a `__DEV__` build, open the drawer › **Component catalog**. It shows every primitive in every state, the live palette, and toggles for appearance and text size. Use it for screenshots and QA.

---

## 1. Direction

Reference: `review/ui-ref/README.md` and `template.html` (chat in 4 states, 3-step setup, icon/splash, component sheet). Configurator default = preset "3a Fogueira": Baloo 2 + Lexend, Fogueira palette, "brasa" light pattern, ember-pill OFFLINE seal.

| Principle | What it means on screen |
|---|---|
| Campfire in the dark | Warm charcoal (or night blue) canvas; content on slightly lighter surfaces; one ember glow rising from the bottom of hero screens (`<Screen ambient>`). |
| One ember | The action color (`a`) marks **the** action: primary button (with glow), send, ACTIVE seal, selection. Never large decorative fills. |
| Gold means verified | `a2` ("verified") marks provenance: sources, LOCAL INDEX labels, relevance bars, the OFFLINE card seal. |
| Friendly type, serious data | Baloo 2 ExtraBold for the wordmark, titles, buttons and big numbers ("62%"); Lexend for everything read; tabular figures for every number. |
| Pills and soft cards | Buttons, inputs, badges and seals are pills; cards are 20pt rounded, borderless in dark (planes read by lightness). |
| Honest statements | The OFFLINE seal and every status seal are claims: show them only when true, with measured numbers. |

## 2. Color

Source of truth: `src/ui/theme/palette.ts`. `SOURCE_PALETTES` holds the designer's values verbatim (bg, s1, s2, bd, mu, tx, a, a2, ink, glow + ok/warn/err). `resolvePalette` maps them to semantic tokens and **only departs from a designer value when an AA floor requires it**, moving OKLCH lightness only (hue and chroma kept). `palette.test.ts` gates every text/background pair (4.5:1), control borders and fills (3:1), and snapshots every departure:

| Palette / mode | Departures (designer → shipped) |
|---|---|
| Fogueira dark (default) | err #F0674F → #F26951 (on s2); strong border derived #866F5E |
| Luar dark | err #F0674F → #F96F57; strong border derived #6C78B1 |
| Fogueira light | action fill #C4541C → #B84909, action text → #A23400, mu → #6A5644, a2 text → #7C4D00, ok/warn/err darkened; strong border #847157 |
| Luar light | action fill #B7700A → #A25D00, action text → #8F4B00, a2 text → #735702, ok/warn/err darkened; strong border #747687 |

Semantic tokens (use these, not palette keys):

| Token | Designer | Use |
|---|---|---|
| `color.bg.canvas` | bg | Screen background |
| `color.bg.surface` | s1 | Cards, list groups, composer |
| `color.bg.raised` | s2 (dark) | Toasts, secondary buttons, chips, progress track |
| `color.bg.sunken` | derived / s2 (light) | Rows inside cards (source items), pressed rows, skeletons |
| `color.text.primary / secondary` | tx / mu | Content / supporting, metadata, placeholders. Both AA on every surface |
| `color.text.disabled` | mu·bg | Decorative or disabled only |
| `color.accent.solid / pressed / soft / text / on` | a, ink | Primary fill (glow) / pressed / tinted bg / action text / label on fill |
| `color.field.solid / soft / text` | a2 | Provenance marks / tinted bg / text |
| `color.status.{success,warning,danger,info}.{solid,soft}` + `danger.fill` | ok/warn/err | Text+icon / tinted bg; `danger.fill` = destructive button |
| `color.line.hairline / strong / focus` | bd / derived / a | Decorative separator / control border (≥3:1) / focus |
| `color.glow`, `color.moon` | glow | "r, g, b" for rgba() glows; Luar moon disc |
| `toneColors(t.color, tone)` | | `{ fg, bg, solid }` for Badge/Banner/Chip |

Rules: state is never color alone; `text.disabled` never carries information; the glow is reserved for the primary action and the OFFLINE seal. Legacy `useTheme().colors` is bridged to the active palette; static `import { colors }` stays on the old look until migrated.

## 3. Type

Bundled fonts (OFL 1.1, `@expo-google-fonts`, loaded from local assets in `App.tsx`, never from the network): **Baloo 2** 700/800 and **Lexend** 400/500/600/700. Each weight is its own family (`src/ui/theme/fonts.ts`); never set `fontWeight` on these, use `<Text weight>`.

| Variant | Font | Size / line | Notes |
|---|---|---|---|
| `display` | Baloo 2 800 | 34 / 37 | Wordmark "boar", hero numbers. Capped 1.5× |
| `title1` | Baloo 2 800 | 26 / 30 | |
| `title2` | Baloo 2 800 | 22 / 26 | Screen titles in content |
| `title3` | Baloo 2 700 | 18 / 23 | Sheet titles, empty states |
| `headline` | Baloo 2 700 | 17 / 22 | Card titles |
| `button` | Baloo 2 800 | 16 / 20 | Button labels, OFFLINE seal |
| `body` | Lexend 400 | 16 / 24 | Default; chat answers |
| `callout` | Lexend 400 | 15 / 22 | |
| `subhead` | Lexend 500 | 14 / 20 | |
| `footnote` | Lexend 400 | 13 / 18 | |
| `caption` | Lexend 400 | 12 / 16 | **Floor: nothing informative below 12** |
| `label` | Lexend 600, +1.1, caps | 12 / 16 | Section overlines, status seals ("ACTIVE", "LOCAL INDEX") |
| `mono` | Lexend 400, tabular | 13 / 19 | Data: sizes, speeds, file names (designer `--fm`) |
| `code` | system monospace | 13 / 20 | Code blocks, hashes |

- Line height is a ratio of size, so it tracks both scales. In-app size preference (0.94 / 1 / 1.12) multiplies the OS font scale. No `maxFontSizeMultiplier` below 2 on content; only `display`, badges and inline chips are capped (1.5).

## 4. Space, radius, size

- 4pt grid: `space.xxs 2 · xs 4 · sm 8 · md 12 · base 16 · lg 20 · xl 24 · xxl 32 · xxxl 40 · huge 48 · giant 64`. Screen gutter 16.
- Radius (from the mockup): `sm 8` bars/tags · `md 14` rows in cards, toasts · `lg 20` cards · `xl 28` sheets · `full` buttons, inputs, badges, seals.
- `size.touch` = 44 (iOS) / 48 (Android). The mockup's 40–42px controls are raised to this.

## 5. Elevation and light

| | Dark (default) | Light |
|---|---|---|
| Planes | canvas → surface → raised by lightness, no borders on cards | hairline + soft warm shadow |
| Floating (sheet) | lightness + deep shadow | stronger soft shadow |
| `elevation.glow` | ember glow `0 0 22px rgba(glow,.45)` on the primary action and the OFFLINE seal only | same, .3 |
| `<Ambient>` / `<Screen ambient>` | Fogueira: ember radial glow from the bottom; Luar: faint moon top-right | 60% strength |

`Ambient` uses RN's CSS `radial-gradient` (`experimental_backgroundImage`); where unsupported it simply doesn't render.

## 6. Motion and haptics

- Durations: `instant 90 · fast 150 · base 220 · slow 320` ms. Enter with `motion.easing.enter` (decelerate), exit with `exit` (accelerate), `standard` for in-place changes.
- `reduceMotion` (from `useTheme()`) → duration 0 for transitions, no pulse/shimmer, static indeterminate progress. Primitives already do this.
- Reanimated 4 is installed (the drawer needs it). Use it for gesture-driven or per-frame work (streaming caret, drag). For simple enter/exit, RN `Animated` with the native driver is enough, as the primitives do.
- Haptics go through `src/services/haptics.ts` (respects the user setting): `impact(Light)` on button press (built into Button/IconButton/ListRow), `selection()` on value changes (Switch, Segmented, Chip), `notification(Error)` on error toasts, `impact(Medium)` on destructive confirm. Don't add haptics to scrolling or streaming.

## 7. Icons

One set: **Feather** via `@expo/vector-icons` (bundled font, works offline). `<Icon name="book-open" />`. Names: https://feathericons.com (the same list is typed in `IconName`).
- Icons are decorative by default (hidden from screen readers). An icon-only control must be an `IconButton`, whose `label` is **required by the type**.
- No emoji as UI icons. Personality or content emoji inside text is fine.

Suggested mapping: menu `menu` · new chat `edit-3` · send `arrow-up` · stop `square` · mic `mic` · sources `book` · knowledge `book-open` · settings `sliders` · performance `activity` · about `info` · model `cpu` · download `download` · delete `trash-2` · copy `copy` · done `check` · offline `wifi-off` · verified `shield` · deep research `layers` · rate `thumbs-up` / `thumbs-down` · reasoning `message-circle`.

## 8. Primitives and their accessibility contract

| Primitive | Use | Built-in a11y (Prism I5) |
|---|---|---|
| `Screen` | Scaffold: canvas, safe area (bottom+sides by default; the native header owns the top), keyboard-aware scroll (`keyboardShouldPersistTaps="handled"`), optional sticky `footer` | Title announced by the native stack |
| `Text` | All text. `variant`, `color`, `numeric`, `weight`, `align`, `header` | Headers for titles; OS font scale on |
| `Icon` | Feather glyph | Hidden unless `label` |
| `Button` | Pill. `primary` (ember fill + glow, one per screen), `secondary` (raised fill), `outline`, `ghost`, `destructive` (danger fill); `sm`; `icon`; `loading`; `fullWidth` | role button, `disabled`/`busy` state, ≥ touch min |
| `IconButton` | Icon-only; `plain`/`tonal`/`filled`; `selected` | `label` required, `selected` state |
| `Card` | Grouped content; `level`, `onPress` | Button role when pressable |
| `Section` | Titled group; `inset` draws the grouped surface with hairlines; `footer` explains effect | Title is a header |
| `ListRow` | Settings/navigation row: `title`, `value`, `subtitle`, `icon`, `trailing` (non-interactive), `switch={{ value, onValueChange }}`, `destructive` | One focus stop reading "title, value, subtitle"; with `switch` the whole row is role switch + `checked`; title/value wrap instead of truncating |
| `Switch` | Immediate on/off only | role switch, `checked`, named by the row text |
| `SegmentedControl` | 2-4 exclusive options | radiogroup + radio `checked`; turns vertical at ≥ 1.35 font scale |
| `Chip` | Filter/toggle/tag; `size="inline"` for citation `[n]` inside text | Button + `selected` when pressable; inline chip keeps a 44/48-tall hit area (horizontal slop is limited so adjacent citations stay separate) |
| `Badge` | Status seal, pill, caps: `solid` = ACTIVE, `soft` = CACHED, `outline` = DOWNLOADING (tone) / NOT ON DISK (neutral); `dot` + `caps={false}` for compatibility seals | Text always present |
| `OfflineSeal` | `pill` (ember, crossed wifi, header), `moon`, `card` (two lines). Only when no network use is guaranteed | One accessible label |
| `Ambient` | Light pattern behind hero screens (usually via `Screen ambient`) | Hidden from readers |
| `Banner` | Inline notice (info/success/warning/danger/field) with optional action and dismiss | Live region (danger assertive) |
| `Toast` | `useToast()({ message, tone, icon, actionLabel, onAction })` | Announced; ≥ 5s + 60ms/char (6s with action); sits above the composer |
| `Sheet` | Confirmations and short tasks; `footer` actions listed safest first (Cancel, then Delete; drawn with the last on top); `returnFocusRef` = the trigger | Modal, focus to title and back to the trigger on close, Android back/scrim close, `accessibilityViewIsModal` |
| `TextField` | Visible `label` (or `accessibilityLabel`), `helper`, `error`, `autoGrow` + `maxRows`, `leading`/`trailing` | Label is the name (not placeholder), error as hint + live |
| `Progress` | Determinate (`value` 0..1, `valueText`) or indeterminate | role progressbar with `accessibilityValue`; `busy` |
| `Skeleton` | Loading placeholder | Hidden; the screen announces loading once |
| `EmptyState` | Empty (`neutral`) and error (`tone="error"`) states with one primary action | Title is a header |
| `useAnnounce()` | `announce(msg, { assertive })` for state changes (answer ready, download failed) | iOS `announceForAccessibilityWithOptions`; Android < 16 `announceForAccessibility` (no priority there: `assertive` is ignored); Android 16+ a 1×1 live-region node in the viewport (UNKNOWN until verified on device, Prism A1) |

Patterns:
- **Destructive = confirm or undo.** Irreversible (delete model, erase data, delete chat): `Sheet` with a `destructive` Button and a ghost Cancel. Reversible: act immediately and offer Undo in a toast.
- **Settings rows show their current value** (`ListRow value`). Toggle only for immediate effect; 3+ options → subscreen or `SegmentedControl`.
- **Errors** say what happened, why if known, and the next action (`EmptyState tone="error"` or `Banner tone="danger"`). No raw "Error: …" strings.
- **Streaming**: announce start and end once (`useAnnounce`), never per token.
- **Dense result lists** (places, sources, models): one row per item inside one inset surface, hairlines between rows, max two text lines, the key number in a right-aligned column with `numeric` and a unit, provenance once in the footer in `field` color, "Show N more" instead of nested scroll. Reference: the geo result card spec (`review/ui-qa/specs/geo-result-card.md`).
- Keyboard: the shell mounts `KeyboardProvider` (react-native-keyboard-controller). `Screen` scrolls focused inputs into view. The chat composer should use the controller's `KeyboardStickyView` / `KeyboardAvoidingView`.
- Safe area: per screen through `Screen edges`. The shell has no global `SafeAreaView`; legacy screens are wrapped in `RootNavigator.tsx` until migrated.

## 9. Navigation

See `docs/adr/0002-ui-navigation.md`. For a screen owner:

```tsx
// Migrating a pushed screen (e.g. Settings) to the native header:
// 1. In RootNavigator.tsx, give the route options:
//    { headerShown: true, title: t("nav.settings"), headerLargeTitle: true, headerShadowVisible: false,
//      headerTintColor: tokens.color.accent.text, headerStyle: { backgroundColor: tokens.color.bg.canvas } }
//    and drop the <Legacy> wrapper.
// 2. In the screen: remove the custom header/Done button, render <Screen>…</Screen>.
// 3. Navigate with useNavigation(): navigation.navigate("Knowledge"), navigation.goBack().
```

Route names: `Main` (drawer › `Chat`), `Setup`, `Settings`, `Knowledge`, `Performance`, `About`, `Catalog` (dev). Add new routes to `src/ui/navigation/types.ts`.

## 10. Migrating a legacy screen (checklist)

1. Replace `import { colors, typography } from "./theme/..."` and `StyleSheet` literals with `useTokens()` inside the component (styles that depend on theme must be built in render or with `useMemo`).
2. Replace raw `Text`/`Pressable` with `Text`/`Button`/`IconButton`/`ListRow`/`Chip`.
3. Replace emoji glyphs with `Icon`.
4. Replace `Alert.alert` confirmations with `Sheet`; transient messages with `useToast`.
5. Every string through i18n (EN + PT). Primitive-level strings live under `ui.*`, shell strings under `nav.*`.
6. Check in the catalog and on device: light, dark, text size large + OS 200%, TalkBack/VoiceOver pass.

## 11. Ownership

- Iris: tokens, primitives, shell/navigation, this doc. Changes to primitives go through Iris (open an issue or `maestri ask "Iris"`), Prism reviews.
- Quill: chat screen and message components, built from these primitives.
- Loom: flows (setup, models, knowledge, settings, about, performance), built from these primitives.
