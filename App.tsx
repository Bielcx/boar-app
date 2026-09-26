import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "./src/i18n";
import { LanguageProvider } from "./src/i18n/LanguageContext";
import { ModelManager } from "./src/models/ModelManager";
import { ThemeProvider, useTokens } from "./src/ui/theme";
import { AnnouncerProvider, ToastProvider } from "./src/ui/components";
import { RootNavigator } from "./src/ui/navigation/RootNavigator";
import { initHaptics } from "./src/services/haptics";

const modelManager = new ModelManager();

function AppContent() {
  const t = useTokens();
  const [initialRoute, setInitialRoute] = useState<"Main" | "Setup" | null>(null);

  useEffect(() => {
    initHaptics();
    (async () => {
      const ready = await modelManager.requiredModelsPresent();
      setInitialRoute(ready ? "Main" : "Setup");
    })();
  }, []);

  if (!initialRoute) {
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
