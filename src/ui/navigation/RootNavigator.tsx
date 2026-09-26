import React, { useMemo } from "react";
import { DarkTheme, DefaultTheme, NavigationContainer, Theme, useNavigation } from "@react-navigation/native";
import { createNativeStackNavigator, NativeStackNavigationProp } from "@react-navigation/native-stack";
import { createDrawerNavigator } from "@react-navigation/drawer";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";
import { Tokens, useTokens } from "../theme";
import { ChatScreen } from "../ChatScreen";
import { SetupWizardScreen } from "../SetupWizardScreen";
import { SettingsScreen } from "../SettingsScreen";
import { SettingsHistoryScreen, SettingsLengthScreen, SettingsToneScreen } from "../SettingsSubscreens";
import { ModelsScreen, ModelSearchScreen } from "../ModelsScreen";
import { KnowledgeScreen } from "../KnowledgeScreen";
import { PerformanceScreen, PerformanceLogsScreen } from "../PerformanceScreen";
import { EvaluationScreen } from "../EvaluationScreen";
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
    <SetupWizardScreen
      onReady={() => navigation.reset({ index: 0, routes: [{ name: "Main" }] })}
      onSkip={navigation.canGoBack() ? () => navigation.goBack() : undefined}
    />
  );
}

function EvaluationRoute() {
  const { generating } = useChatBridge();
  return <EvaluationScreen chatBusy={generating} />;
}

/** Native header for the flow screens (Loom): large title on the canvas, back and gesture from the stack. */
function flowHeader(t: Tokens, title: string, large = true) {
  return {
    headerShown: true,
    title,
    headerLargeTitle: large,
    headerShadowVisible: false,
    headerTintColor: t.color.accent.text,
    headerTitleStyle: { color: t.color.text.primary },
    headerLargeTitleStyle: { color: t.color.text.primary },
    headerStyle: { backgroundColor: t.color.bg.canvas },
    headerBackButtonDisplayMode: "minimal" as const,
  };
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
        <Stack.Screen name="Settings" component={SettingsScreen} options={flowHeader(t, tr("nav.settings"))} />
        <Stack.Screen name="SettingsTone" component={SettingsToneScreen} options={flowHeader(t, tr("flows.settings.tone"), false)} />
        <Stack.Screen name="SettingsLength" component={SettingsLengthScreen} options={flowHeader(t, tr("flows.settings.length"), false)} />
        <Stack.Screen name="SettingsHistory" component={SettingsHistoryScreen} options={flowHeader(t, tr("flows.settings.history"), false)} />
        <Stack.Screen name="Models" component={ModelsScreen} options={flowHeader(t, tr("flows.settings.models"))} />
        <Stack.Screen name="ModelSearch" component={ModelSearchScreen} options={flowHeader(t, tr("flows.models.searchTitle"), false)} />
        <Stack.Screen name="Knowledge" component={KnowledgeScreen} options={flowHeader(t, tr("nav.knowledge"))} />
        <Stack.Screen name="Performance" component={PerformanceScreen} options={flowHeader(t, tr("nav.performance"))} />
        <Stack.Screen name="PerformanceLogs" component={PerformanceLogsScreen} options={flowHeader(t, tr("flows.performance.logsTitle"), false)} />
        <Stack.Screen name="Evaluation" component={EvaluationRoute} options={flowHeader(t, tr("flows.performance.evaluationTitle"), false)} />
        <Stack.Screen name="About" component={AboutScreen} options={flowHeader(t, tr("nav.about"))} />
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
