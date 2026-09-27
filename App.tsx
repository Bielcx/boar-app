import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
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

const modelManager = new ModelManager();

function AppContent() {
  const t = useTokens();
  const [initialRoute, setInitialRoute] = useState<"Main" | "Setup" | null>(null);
  // Brand fonts are bundled; this resolves from local assets. On error, fall
  // back to system fonts rather than blocking the app.
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);

  useEffect(() => {
    initHaptics();
    (async () => {
      const ready = await modelManager.requiredModelsPresent();
      setInitialRoute(ready ? "Main" : "Setup");
    })();
  }, []);

  if (!initialRoute || (!fontsLoaded && !fontError)) {
    return (
      <View style={[styles.centered, { backgroundColor: t.color.bg.canvas }]}>
        <ActivityIndicator color={t.color.accent.solid} size="large" />
      </View>
    );
  }
  return <RootNavigator initialRoute={initialRoute} />;
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
