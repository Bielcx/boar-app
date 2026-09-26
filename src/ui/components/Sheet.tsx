import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, findNodeHandle, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme";
import { IconButton } from "./IconButton";
import { Text } from "./Text";

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  /** Sticky footer actions, listed safest first (Cancel before Delete); drawn bottom-up so the last one is on top. */
  footer?: React.ReactNode;
  /** Hide the close button, e.g. for a forced choice. Back/scrim still close unless `dismissible` is false. */
  showClose?: boolean;
  dismissible?: boolean;
  /** Element to give screen-reader focus back to when the sheet closes (usually the trigger). */
  returnFocusRef?: React.RefObject<View | null>;
}

/**
 * Bottom sheet for short tasks and confirmations (destructive actions, pickers).
 * Modal: traps focus, closes on Android back / scrim tap / close button, and
 * moves screen-reader focus to the title on open.
 */
export function Sheet({
  visible,
  onClose,
  title,
  description,
  children,
  footer,
  showClose = true,
  dismissible = true,
  returnFocusRef,
}: SheetProps) {
  const { tokens: t, reduceMotion } = useTheme();
  const { t: tr } = useTranslation();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  const titleRef = useRef<View>(null);

  useEffect(() => {
    if (visible) setMounted(true);
    const duration = reduceMotion ? 0 : visible ? t.motion.duration.base : t.motion.duration.fast;
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration,
      easing: visible ? t.motion.easing.enter : t.motion.easing.exit,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
        const trigger = returnFocusRef?.current && findNodeHandle(returnFocusRef.current);
        if (trigger) setTimeout(() => AccessibilityInfo.setAccessibilityFocus(trigger), 50);
      }
      if (finished && visible) {
        const node = titleRef.current && findNodeHandle(titleRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, progress, reduceMotion, t.motion]);

  if (!mounted) return null;
  const close = () => dismissible && onClose();

  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={close}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.color.bg.scrim, opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={tr("ui.close")}
          importantForAccessibility="no"
          accessibilityElementsHidden
        />
      </Animated.View>
      <KeyboardAvoidingView behavior="padding" style={styles.anchor} pointerEvents="box-none">
        <Animated.View
          accessibilityViewIsModal
          style={{
            maxHeight: "90%",
            backgroundColor: t.color.bg.raised,
            borderTopLeftRadius: t.radius.xl,
            borderTopRightRadius: t.radius.xl,
            borderWidth: t.size.hairline,
            borderColor: t.color.line.hairline,
            paddingBottom: Math.max(insets.bottom, t.space.base),
            transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [400, 0] }) }],
            ...(t.elevation[3] as object),
          }}
        >
          <View style={[styles.grabber, { backgroundColor: t.color.line.strong }]} />
          <View style={[styles.header, { paddingHorizontal: t.space.base, gap: t.space.sm }]}>
            <View ref={titleRef} accessible style={{ flex: 1, gap: t.space.xs, paddingTop: t.space.sm }}>
              <Text variant="title3" header>
                {title}
              </Text>
              {description && (
                <Text variant="callout" color="secondary">
                  {description}
                </Text>
              )}
            </View>
            {showClose && dismissible && <IconButton icon="x" label={tr("ui.close")} onPress={onClose} />}
          </View>
          {children && (
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: t.space.base, paddingTop: t.space.md, gap: t.space.md }}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          )}
          {footer && (
            // Footer children are given safest-first (Cancel, then the action) for focus order,
            // and drawn in reverse so the main action sits on top.
            <View style={{ flexDirection: "column-reverse", paddingHorizontal: t.space.base, paddingTop: t.space.base, gap: t.space.sm }}>
              {footer}
            </View>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  anchor: { flex: 1, justifyContent: "flex-end" },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginTop: 8, opacity: 0.6 },
  header: { flexDirection: "row", alignItems: "flex-start" },
});
