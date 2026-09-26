import React, { useMemo } from "react";
import { DarkTheme, DefaultTheme, NavigationContainer, Theme, useNavigation } from "@react-navigation/native";
import { createNativeStackNavigator, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";
import { Tokens, useTokens } from "../theme";
import { ChatScreen } from "../ChatScreen";
import { ModelSetupScreen } from "../ModelSetupScreen";
import { SetupWizardScreen } from "../SetupWizardScreen";
import { KnowledgeBaseScreen } from "../KnowledgeBaseScreen";
import { ExecutionTelemetryScreen } from "../ExecutionTelemetryScreen";
import { AboutScreen } from "../AboutScreen";
import { ComponentCatalogScreen } from "../dev/ComponentCatalogScreen";
import { AppDrawerContent } from "./AppDrawerContent";
import { useChatBridge } from "./chatBridge";
import type { DrawerParamList, RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Drawer = createDrawerNavigator<DrawerParamList>();

type RootNav = NativeStackNavigationProp<RootStackParamList>;

function navigationTheme(t: Tokens): Theme {
  const base = t.scheme === "dark" ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: t.color.accent.solid,
      background: t.color.bg.canvas,
      card: t.color.bg.canvas,
      text: t.color.text.primary,
      border: t.color.line.hairline,
      notification: t.color.accent.solid,
    },
  };
}

/**
 * Screens that still draw their own header and close button (owned by Loom,
 * migrating to <Screen> + the native header). They get the system back
 * gesture and Android back from the stack; the safe area is padded here
 * until they move to <Screen>.
 */
function Legacy({ children }: { children: React.ReactNode }) {
  const t = useTokens();
  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: t.color.bg.canvas }}>
      {children}
    </SafeAreaView>
  );
}

function ChatRoute() {
  const navigation = useNavigation<RootNav>();
  return (
    <Legacy>
      <ChatScreen onRelaunchWizard={() => navigation.navigate("Setup")} />
    </Legacy>
  );
}

function SetupRoute() {
  const navigation = useNavigation<RootNav>();
  return (
    <Legacy>
      <SetupWizardScreen
        onReady={() => navigation.reset({ index: 0, routes: [{ name: "Main" }] })}
        onSkip={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      />
    </Legacy>
  );
}

function SettingsRoute() {
  const navigation = useNavigation<RootNav>();
  return (
    <Legacy>
      <ModelSetupScreen mode="optional" onClose={() => navigation.goBack()} onRelaunchWizard={() => navigation.navigate("Setup")} />
    </Legacy>
  );
}

function KnowledgeRoute() {
  const navigation = useNavigation<RootNav>();
  return (
    <Legacy>
      <KnowledgeBaseScreen onClose={() => navigation.goBack()} />
    </Legacy>
  );
}

function PerformanceRoute() {
  const navigation = useNavigation<RootNav>();
  const { generating } = useChatBridge();
  return (
    <Legacy>
      <ExecutionTelemetryScreen chatBusy={generating} onClose={() => navigation.goBack()} />
    </Legacy>
  );
}

function AboutRoute() {
  const navigation = useNavigation<RootNav>();
  return (
    <Legacy>
      <AboutScreen onClose={() => navigation.goBack()} />
    </Legacy>
  );
}

function MainDrawer() {
  const t = useTokens();
  return (
    <Drawer.Navigator
      drawerContent={(props) => <AppDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: "front",
        swipeEdgeWidth: 32,
        overlayColor: t.color.bg.scrim,
        drawerStyle: { width: 312, backgroundColor: t.color.bg.surface },
      }}
    >
      <Drawer.Screen name="Chat" component={ChatRoute} />
    </Drawer.Navigator>
  );
}

export function RootNavigator({ initialRoute }: { initialRoute: "Main" | "Setup" }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const theme = useMemo(() => navigationTheme(t), [t]);
  return (
    <NavigationContainer theme={theme}>
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} />
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: t.color.bg.canvas },
          animation: "default",
        }}
      >
        <Stack.Screen name="Main" component={MainDrawer} />
        <Stack.Screen name="Setup" component={SetupRoute} options={{ gestureEnabled: false, animation: "fade" }} />
        <Stack.Screen name="Settings" component={SettingsRoute} />
        <Stack.Screen name="Knowledge" component={KnowledgeRoute} />
        <Stack.Screen name="Performance" component={PerformanceRoute} />
        <Stack.Screen name="About" component={AboutRoute} />
        <Stack.Screen
          name="Catalog"
          component={ComponentCatalogScreen}
          options={{
            headerShown: true,
            title: tr("nav.catalog"),
            headerLargeTitle: true,
            headerShadowVisible: false,
            headerTintColor: t.color.accent.text,
            headerTitleStyle: { color: t.color.text.primary },
            headerStyle: { backgroundColor: t.color.bg.canvas },
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
