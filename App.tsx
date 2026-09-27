import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";
import "./src/i18n";
import { LanguageProvider } from "./src/i18n/LanguageContext";
import { ModelManager } from "./src/models/ModelManager";
import { ThemeProvider, useTokens } from "./src/ui/theme";
import { FONT_FILES } from "./src/ui/theme/fontFiles";
import { AnnouncerProvider, ToastProvider } from "./src/ui/components";
import { RootNavigator } from "./src/ui/navigation/RootNavigator";
import { initHaptics } from "./src/services/haptics";
import { initialRoute as bootRoute } from "./src/ui/flows/boot";
import { BootSplash } from "./src/ui/flows/BootSplash";
import { registerGeoProviders } from "./src/routing/answerService";
import { geoProvidersFrom } from "./src/routing/geoWiring";
import { getCurrentPoint, getLocationFix } from "./src/services/location";
import { installedPoiPacks, resolvePlace, searchPois } from "./src/rag/pois";
import { POI_REGIONS } from "./src/rag/poiRegions";

// Offline places: without this, every places question answers "places pack not installed".
registerGeoProviders(
  geoProvidersFrom({
    installedPoiPacks,
    getCurrentPoint,
    getLocationFix,
    resolvePlace,
    searchPois,
    cities: () => POI_REGIONS.flatMap((r) => r.cities),
  })
);

const modelManager = new ModelManager();

// Keep the native splash (same canvas, mascot and wordmark) up until the first real screen can
// draw, instead of flashing a bare spinner between the two (iOS cd50fdc splash sequence).
SplashScreen.preventAutoHideAsync().catch(() => {});
// Boot timing (splash decision): how long the native splash covers the JS start. Read in logcat / Xcode.
const BOOT_T0 = Date.now();
console.info(`[boot] js-start t=${BOOT_T0}`);

function AppContent() {
  const t = useTokens();
  const [initialRoute, setInitialRoute] = useState<"Main" | "Setup" | null>(null);
  // Brand fonts are bundled; this resolves from local assets. On error, fall
  // back to system fonts rather than blocking the app.
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);

  useEffect(() => {
    initHaptics();
    (async () => {
      // Setup unless the chat has an answer model it can load (and saves that one as active).
      // A failed disk read also lands in setup, never on a spinner or a chat that cannot answer.
      setInitialRoute(await bootRoute(modelManager).catch(() => "Setup" as const));
    })();
  }, []);

  const ready = !!initialRoute && (fontsLoaded || !!fontError);
  // The native splash (a static image) hands over to BootSplash, the same image plus the tagline
  // and an indeterminate bar, as soon as it has drawn; boot measured ~1.0 s on iOS (Harbor), long
  // enough for the bar to be seen. If the app is ready before BootSplash mounts, hide on ready.
  const nativeHidden = useRef(false);
  const hideNative = useCallback(() => {
    if (nativeHidden.current) return;
    nativeHidden.current = true;
    // Boot timing for Tusk's measurements (the native splash is released here).
    console.info(`[boot] hide after=${Date.now() - BOOT_T0}ms`);
    SplashScreen.hideAsync().catch(() => {});
  }, []);
  useEffect(() => {
    if (ready) hideNative();
  }, [ready, hideNative]);

  if (!ready) {
    return <BootSplash onFirstLayout={hideNative} textReady={fontsLoaded || !!fontError} />;
  }
  return <RootNavigator initialRoute={initialRoute!} />;
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      {/* Real insets on the first frame, so the shell does not jump as the splash fades (Prism SA-1). */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <KeyboardProvider>
          <LanguageProvider>
            <ThemeProvider>
              <AnnouncerProvider>
                <ToastProvider>
                  <AppContent />
                </ToastProvider>
              </AnnouncerProvider>
            </ThemeProvider>
          </LanguageProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
});
