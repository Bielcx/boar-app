import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "./src/i18n";
import { LanguageProvider } from "./src/i18n/LanguageContext";
import { ModelManager } from "./src/models/ModelManager";
import { ThemeProvider, useTokens } from "./src/ui/theme";
import { FONT_FILES } from "./src/ui/theme/fontFiles";
import { AnnouncerProvider, ToastProvider } from "./src/ui/components";
import { RootNavigator } from "./src/ui/navigation/RootNavigator";
import { initHaptics } from "./src/services/haptics";
import { initialRoute as bootRoute } from "./src/ui/flows/boot";

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
      // Setup unless the chat has an answer model it can load (and saves that one as active).
      // A failed disk read also lands in setup, never on a spinner or a chat that cannot answer.
      setInitialRoute(await bootRoute(modelManager).catch(() => "Setup" as const));
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
      <SafeAreaProvider>
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
