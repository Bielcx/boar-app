# BOAR design system

TL;DR
- Import primitives from `src/ui/components` and tokens from `useTheme()` / `useTokens()`. No hex, no `fontSize`, no emoji icons in screens.
- Direction: **a field instrument you can trust offline**. Warm paper and ink by day, warm charcoal by night. Terracotta is the one action color; olive marks provenance (sources, offline, verified on device).
- Appearance is **system / light / dark**. The three old dark themes (Ocean, Amber, Matrix) are gone.
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

| Principle | What it means on screen |
|---|---|
| Instrument, not toy | Numbers are measured and labeled with units, in tabular figures (`<Text numeric>`). No "Runs great!" or badges that aren't backed by a measurement. |
| Ink on paper | Content sits on quiet warm neutrals. Hierarchy comes from type weight and spacing, not from colored boxes. |
| One accent | Terracotta (from the boar's hide) marks **the** action on a screen: primary button, send, selection. Never decoration, never large fills. |
| Provenance in olive | Olive (from the field hat) marks where knowledge comes from: sources, citations, "offline", checksum verified. |
| Hairlines before shadows | Separate with 1px hairlines and surface steps. Shadows only for things that float (sheets, toasts), and only in light mode. |
| Calm motion | Short, decelerating transitions. Nothing loops except progress. Reduce Motion turns non-essential animation off. |

The mascot (`assets/boar.png`) appears in the drawer header, onboarding and empty states. Not in every header.

## 2. Color

Authored in OKLCH (perceptually even steps), shipped as hex. Source of truth: `src/ui/theme/palette.ts`. `palette.test.ts` re-derives every hex from its OKLCH value and **fails the build if any text/background pair drops below WCAG AA** (4.5:1 text, 3:1 control borders and accent).

| Palette key | Light | Dark |
|---|---|---|
| `canvas` | `#F8F5F1` oklch(0.972 0.007 80) | `#110E0B` oklch(0.165 0.008 62) |
| `surface` | `#FEFCF9` oklch(0.992 0.004 80) | `#191512` oklch(0.2 0.009 62) |
| `surfaceRaised` | `#FFFFFF` oklch(1 0 0) | `#221D19` oklch(0.235 0.01 62) |
| `sunken` | `#F1EDE7` oklch(0.948 0.009 78) | `#0B0907` oklch(0.14 0.007 62) |
| `hairline` | `#DED8D1` oklch(0.885 0.011 72) | `#2F2A26` oklch(0.29 0.01 62) |
| `hairlineStrong` | `#8C857E` oklch(0.62 0.014 65) | `#6E6862` oklch(0.52 0.012 65) |
| `textPrimary` | `#231C18` oklch(0.235 0.014 55) | `#F0ECE7` oklch(0.945 0.008 78) |
| `textSecondary` | `#574E47` oklch(0.43 0.016 58) | `#BFB9B2` oklch(0.79 0.012 72) |
| `textTertiary` | `#726A64` oklch(0.53 0.014 62) | `#9D9791` oklch(0.68 0.012 68) |
| `textDisabled` | `#A9A39E` oklch(0.72 0.01 65) | `#5C5752` oklch(0.46 0.01 65) |
| `accent` | `#B15229` oklch(0.55 0.135 42) | `#DE845A` oklch(0.7 0.125 45) |
| `accentPressed` | `#994222` oklch(0.49 0.125 40) | `#C8724E` oklch(0.64 0.12 43) |
| `accentSoft` | `#FBE4D8` oklch(0.935 0.03 50) | `#3E2418` oklch(0.29 0.045 45) |
| `accentText` | `#9E4421` oklch(0.5 0.13 40) | `#EA9B72` oklch(0.76 0.11 48) |
| `onAccent` | `#FFFDFA` oklch(0.995 0.004 80) | `#190F0A` oklch(0.18 0.02 45) |
| `field` | `#626834` oklch(0.5 0.075 115) | `#A9B273` oklch(0.74 0.085 115) |
| `fieldSoft` | `#E9ECD5` oklch(0.935 0.03 112) | `#282B16` oklch(0.28 0.035 115) |
| `fieldText` | `#545A2A` oklch(0.45 0.07 115) | `#B5BE7F` oklch(0.78 0.085 115) |
| `success` | `#227240` oklch(0.49 0.11 152) | `#6CC185` oklch(0.74 0.12 152) |
| `successSoft` | `#DBF2E0` oklch(0.94 0.035 152) | `#142D1B` oklch(0.27 0.045 152) |
| `warning` | `#8D5E00` oklch(0.52 0.11 75) | `#E6B55D` oklch(0.8 0.12 80) |
| `warningSoft` | `#FEEDC9` oklch(0.95 0.05 85) | `#38280A` oklch(0.29 0.05 80) |
| `danger` | `#B6322D` oklch(0.52 0.17 27) | `#F1786D` oklch(0.71 0.15 27) |
| `dangerSoft` | `#FDE7E4` oklch(0.945 0.025 25) | `#421C19` oklch(0.28 0.06 25) |
| `info` | `#326893` oklch(0.5 0.09 245) | `#79B1E0` oklch(0.74 0.09 245) |
| `infoSoft` | `#E2EFFA` oklch(0.945 0.02 245) | `#152839` oklch(0.27 0.04 245) |
| `scrim` | `#1A1512` oklch(0.2 0.01 55) | `#020201` oklch(0.08 0.005 60) |

Semantic tokens (use these, not palette keys):

| Token | Use |
|---|---|
| `color.bg.canvas` | Screen background |
| `color.bg.surface` | Cards, grouped lists, inputs |
| `color.bg.raised` | Sheets, toasts, menus |
| `color.bg.sunken` | Wells, code, pressed rows, skeletons |
| `color.bg.scrim` | Behind sheets and the drawer |
| `color.text.primary / secondary / tertiary` | Content / supporting / metadata and placeholders. **All three pass AA on every surface.** |
| `color.text.disabled` | Decorative or disabled only. Fails AA on purpose. Never carries information. |
| `color.text.accent`, `color.text.field` | Accent and provenance text (links, source names) |
| `color.line.hairline` | Separators (decorative) |
| `color.line.strong` | Control borders that are the affordance (inputs, switch track off). ≥ 3:1 |
| `color.accent.solid / pressed / soft / text / on` | Primary action fill / pressed / tinted background / text on soft / text on solid |
| `color.field.solid / soft / text` | Provenance |
| `color.status.{success,warning,danger,info}.{solid,soft}` | `solid` works as text and icon color on any surface; `soft` is the tinted background |
| `toneColors(t.color, tone)` | `{ fg, bg, solid }` for a tone, used by Badge/Banner/Chip |

Rules:
- State is never color alone: pair it with an icon or text (Badge always has a label).
- Dark mode is **warm charcoal with no blue**: the night-reading case that the old Amber theme covered (Prism I3) is served by dark mode itself. Pure OLED black is not used; it smears on scroll and makes hairlines invisible.
- Legacy: `useTheme().colors` (old shape) still works and is now **bridged to the new palette**, so screens that call `useTheme()` already follow light/dark. Files that `import { colors } from "./theme/colors"` statically stay on the old midnight look until migrated.

## 3. Type

System fonts (SF Pro / Roboto): best Dynamic Type support, zero bytes, familiar. Monospace (Menlo / monospace) only for code, hashes and raw values; for numbers in UI use `numeric` (tabular figures) on a sans variant.

| Variant | Size / line | Weight | Notes |
|---|---|---|---|
| `display` | 32 / 38 | 700, −0.5 | Onboarding hero only. Capped at 1.5× OS scale |
| `title1` | 26 / 32 | 700, −0.3 | Screen titles when not in the native header |
| `title2` | 21 / 27 | 600 | |
| `title3` | 18 / 24 | 600 | Sheet titles, empty states |
| `headline` | 16 / 22 | 600 | Card titles, button labels |
| `body` | 16 / 24 | 400 | Default. Chat answers |
| `callout` | 15 / 22 | 400 | Secondary blocks |
| `subhead` | 14 / 20 | 500 | Labels, segmented options |
| `footnote` | 13 / 18 | 400 | Row subtitles, helper text |
| `caption` | 12 / 16 | 400 | Metadata. **Floor: nothing informative below 12** |
| `label` | 12 / 16 | 600, +0.6, uppercase | Section overlines |
| `mono` | 13 / 19 | 400 | Code and raw values |

- Line height is a ratio of size, so it tracks both scales.
- In-app size preference (`compact` 0.94 / `standard` 1 / `large` 1.12) multiplies on top of the **OS font scale**, which stays on (`allowFontScaling`). No `maxFontSizeMultiplier` below 2 on content; only `display`, badges and inline citation chips are capped (1.5).
- `display`/`title1-3` are announced as headers automatically; pass `header` for others.

## 4. Space, radius, size

- 4pt grid: `space.xxs 2 · xs 4 · sm 8 · md 12 · base 16 · lg 20 · xl 24 · xxl 32 · xxxl 40 · huge 48 · giant 64`. Screen gutter = `base` (16). Between sections = `xl` (24).
- Radius: `xs 4` (inline chips) · `sm 8` (badges, segments) · `md 12` (buttons, inputs, list groups) · `lg 16` (cards) · `xl 24` (sheet top) · `full`.
- `size.touch` = 44 (iOS) / 48 (Android). Visuals may be smaller (36pt icon button); the hit area is completed with `hitSlop` inside the primitive.
- `size.hairline` = `StyleSheet.hairlineWidth`.

## 5. Elevation

| Level | Light | Dark |
|---|---|---|
| 0 | flat on canvas | flat |
| 1 | surface + hairline + 1px soft shadow | surface + hairline |
| 2 | raised + hairline + medium shadow | raised + hairline |
| 3 | sheets, toasts: long soft shadow | raised + hairline |

Shadows are `boxShadow` strings (new architecture, both platforms). Never colored glows.

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
| `Button` | `primary` (one per screen), `secondary`, `ghost`, `destructive`; `sm`; `icon`; `loading`; `fullWidth` | role button, `disabled`/`busy` state, ≥ touch min |
| `IconButton` | Icon-only; `plain`/`tonal`/`filled`; `selected` | `label` required, `selected` state |
| `Card` | Grouped content; `level`, `onPress` | Button role when pressable |
| `Section` | Titled group; `inset` draws the grouped surface with hairlines; `footer` explains effect | Title is a header |
| `ListRow` | Settings/navigation row: `title`, `value`, `subtitle`, `icon`, `trailing` (non-interactive), `switch={{ value, onValueChange }}`, `destructive` | One focus stop reading "title, value, subtitle"; with `switch` the whole row is role switch + `checked`; title/value wrap instead of truncating |
| `Switch` | Immediate on/off only | role switch, `checked`, named by the row text |
| `SegmentedControl` | 2-4 exclusive options | radiogroup + radio `checked`; turns vertical at ≥ 1.35 font scale |
| `Chip` | Filter/toggle/tag; `size="inline"` for citation `[n]` inside text | Button + `selected` when pressable; inline chip keeps a 44/48-tall hit area (horizontal slop is limited so adjacent citations stay separate) |
| `Badge` | Non-interactive status with tone | Text always present |
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
