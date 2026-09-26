import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { notification, NotificationFeedbackType } from "../../services/haptics";
import { toneColors, useTheme } from "../theme";
import { useAnnounce } from "./Announcer";
import { Button } from "./Button";
import { Icon, IconName } from "./Icon";
import { Text } from "./Text";

export interface ToastOptions {
  message: string;
  tone?: "neutral" | "success" | "danger";
  icon?: IconName;
  /** e.g. "Undo". The toast stays at least 6s when it has an action. */
  actionLabel?: string;
  onAction?: () => void;
  /** Override the reading-time based duration (ms). */
  duration?: number;
}

type Show = (options: ToastOptions) => void;
const ToastContext = createContext<Show>(() => {});

/** Minimum on-screen time: 5s base + ~60ms per character; 6s floor with an action. */
export function toastDuration(message: string, hasAction: boolean): number {
  return Math.max(hasAction ? 6000 : 5000, 5000 + message.length * 60);
}

/** Mounted once in the shell. `const toast = useToast(); toast({ message, actionLabel: t("ui.undo"), onAction })`. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<(ToastOptions & { id: number }) | null>(null);
  const idRef = useRef(0);
  const show = useCallback<Show>((options) => {
    idRef.current += 1;
    setCurrent({ ...options, id: idRef.current });
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {current && <ToastView key={current.id} toast={current} onDone={() => setCurrent(null)} />}
    </ToastContext.Provider>
  );
}

export function useToast(): Show {
  return useContext(ToastContext);
}

function ToastView({ toast, onDone }: { toast: ToastOptions; onDone: () => void }) {
  const { tokens: t, reduceMotion } = useTheme();
  const insets = useSafeAreaInsets();
  const announce = useAnnounce();
  const anim = useRef(new Animated.Value(0)).current;
  const tone = toast.tone ?? "neutral";
  const tc = toneColors(t.color, tone === "neutral" ? "neutral" : tone);

  const hide = useCallback(() => {
    Animated.timing(anim, { toValue: 0, duration: reduceMotion ? 0 : t.motion.duration.fast, useNativeDriver: true }).start(onDone);
  }, [anim, onDone, reduceMotion, t.motion.duration.fast]);

  useEffect(() => {
    announce(toast.actionLabel ? `${toast.message}. ${toast.actionLabel}` : toast.message, { assertive: tone === "danger" });
    if (tone === "danger") notification(NotificationFeedbackType.Error);
    Animated.timing(anim, {
      toValue: 1,
      duration: reduceMotion ? 0 : t.motion.duration.base,
      easing: t.motion.easing.enter,
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(hide, toast.duration ?? toastDuration(toast.message, !!toast.actionLabel));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: "flex-end" }]}>
      <Animated.View
        style={{
          marginHorizontal: t.space.base,
          marginBottom: insets.bottom + 88,
          flexDirection: "row",
          alignItems: "center",
          gap: t.space.md,
          paddingLeft: t.space.base,
          paddingRight: toast.actionLabel ? t.space.xs : t.space.base,
          paddingVertical: t.space.xs,
          minHeight: t.size.touch + 4,
          borderRadius: t.radius.md,
          backgroundColor: t.color.bg.raised,
          borderWidth: t.size.hairline,
          borderColor: t.color.line.hairline,
          opacity: anim,
          transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          ...(t.elevation[3] as object),
        }}
      >
        {(toast.icon || tone !== "neutral") && (
          <Icon name={toast.icon ?? (tone === "danger" ? "alert-octagon" : "check")} color={tc.fg} />
        )}
        <Text variant="callout" style={{ flex: 1, paddingVertical: t.space.sm }}>
          {toast.message}
        </Text>
        {toast.actionLabel && toast.onAction && (
          <Button
            label={toast.actionLabel}
            variant="ghost"
            size="sm"
            onPress={() => {
              toast.onAction?.();
              hide();
            }}
          />
        )}
      </Animated.View>
    </View>
  );
}
