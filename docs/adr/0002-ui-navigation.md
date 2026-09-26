# ADR 0002: UI navigation shell

- Status: accepted (Iris, UI lead), 2026-09-26
- Scope: `App.tsx`, `src/ui/navigation/*`, how screens are reached and left
- Related: `review/ui-qa/ux-audit.md` (§1.1, §2), `review/ui-qa/flows-spec.md` §3 (IA)

## Context

Before this change the app had no navigation library:

- `App.tsx` switched between three states (`checking`, `required-setup`, `chat`).
- Every secondary screen (Settings, Knowledge, Telemetry, About) was an early `return` inside `ChatScreen`, driven by booleans.
- The drawer was a homemade `Animated` panel with no swipe gesture.
- There was no `BackHandler` anywhere, so **Android back closed the app** from any screen, including with the drawer open. iOS had no swipe-back. Returning to the chat unmounted and remounted its list, so the scroll position was lost.

The app ships on iOS and Android only (no web). The bounty judges an app that should feel native on both.

## Decision

Use **React Navigation 7**: a root **native stack** (`@react-navigation/native-stack`, backed by `react-native-screens`) with a **drawer navigator** (`@react-navigation/drawer`) as its first route.

```
NavigationContainer (theme from tokens)
└─ Stack (native)
   ├─ Main ─ Drawer (gesture, AppDrawerContent)
   │         └─ Chat            (ChatScreen, stays mounted)
   ├─ Setup                     (SetupWizardScreen; initial route when required models are missing)
   ├─ Settings | Knowledge | Performance | About   (pushed, system back + swipe-back)
   └─ Catalog                   (dev-only component catalog, native large-title header)
```

Details:

- `App.tsx` picks the initial route (`Main` or `Setup`) and renders `RootNavigator`. The wizard is called directly, no longer through `ModelSetupScreen mode="required"`.
- After setup, `navigation.reset` to `Main` (the chat mounts fresh, as before). Relaunching the wizard from Settings pushes `Setup` with `onSkip` = go back.
- Drawer: new chat, recent sessions (delete asks for confirmation in a Sheet; the retention limit is shown), then Knowledge, Settings and Performance (Catalog in `__DEV__`; About is reached from Settings). Android back closes an open drawer before anything else (built into the drawer navigator).
- `ChatScreen` keeps owning sessions and the engine. It re-syncs settings (deep research, voice, active model) every time it regains focus after a pushed screen, whichever way that screen was opened. It publishes sessions and handlers through `src/ui/navigation/chatBridge.ts` (a small external store) so the drawer, which now lives outside the chat, can use them. Returning from Settings re-syncs deep research, voice input and the active model on refocus, so the back gesture behaves like "Done".
- Screens not yet migrated keep their own header and close button; the stack runs with `headerShown: false` for them and wraps them in a safe-area view (`Legacy` in `RootNavigator.tsx`). As Loom moves each screen to `<Screen>`, it turns the native header on for that route and removes the in-screen header.

## Alternatives considered

| Option | Why not |
|---|---|
| **expo-router** (file-based) | Same engine underneath (React Navigation), but restructures the entry point and every screen into `app/` routes, and adds typed-routes/linking we don't need (no web, no deep links yet). Bigger diff across files owned by Quill and Loom for the same user-visible result. Can be adopted later without changing screens' internals, since both use React Navigation primitives. |
| Keep the homemade drawer and add `BackHandler` | Fixes Android back only. No swipe-back, no native transitions, no screen stack (scroll loss stays), and every new screen repeats the boolean pattern. |
| JS stack (`@react-navigation/stack`) | Works, but native-stack gives platform transitions, iOS large titles, native header and form sheets for free, with less JS work per frame. |
| Tabs | Chat is the home and the only frequent destination. Tabs would spend permanent screen height on places visited rarely (Settings, Knowledge). A drawer matches the chat-app pattern users know. |

## Consequences

- New native dependencies (all at the SDK 57 versions from `npx expo install`): `react-native-screens`, `react-native-gesture-handler`, `react-native-reanimated` + `react-native-worklets` (required by the drawer; also available for motion), plus `react-native-keyboard-controller` and `expo-system-ui` for the design system. **The dev client and release builds must be rebuilt** (Android via Piston, iOS on the mini via Harbor's script). OTA-only updates won't pick this up.
- `app.json` `userInterfaceStyle` is now `automatic` so the OS dark/light setting reaches the app.
- `Drawer.tsx` and `DrawerFooterStats.tsx` are removed. The drawer no longer shows performance stats (the Performance screen owns them).
- The Chat screen is never unmounted by visiting another screen, so scroll position and in-flight generation survive.

## Risks and rollback

- Risk: a native module mismatch crashes at startup on a stale dev client. Mitigation: rebuild; `npx expo-doctor` before release.
- Risk: `KeyboardProvider` changes how Android reports keyboard insets, and `ChatScreen` still pads for the keyboard by hand. Needs device check (UNKNOWN below); Quill's composer rework moves the chat to `KeyboardStickyView`.
- Rollback: revert the `feat(nav)` commit. The primitives and tokens don't depend on the navigator.

## Success criteria

- Android back: closes drawer → pops the pushed screen → exits only from Chat. iOS swipe-back works on every pushed screen.
- Returning from Settings keeps the chat scroll position and applies a changed model.
- No screen draws under the status bar, Dynamic Island or home indicator (Harbor/Piston screenshots).

UNKNOWN: none of the above was run on a device yet; tsc and vitest pass and the Android JS bundle builds (`expo export`).
