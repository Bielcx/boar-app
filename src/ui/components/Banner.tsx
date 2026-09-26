import React from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { toneColors, useTokens } from "../theme";
import { Button } from "./Button";
import { Icon, IconName } from "./Icon";
import { IconButton } from "./IconButton";
import { Text } from "./Text";

export type BannerTone = "info" | "success" | "warning" | "danger" | "field";

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  message: string;
  icon?: IconName;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
}

const DEFAULT_ICON: Record<BannerTone, IconName> = {
  info: "info",
  success: "check-circle",
  warning: "alert-triangle",
  danger: "alert-octagon",
  field: "shield",
};

/**
 * Inline, persistent notice inside the content flow (not floating). Errors
 * are announced assertively, everything else politely.
 */
export function Banner({ tone = "info", title, message, icon, actionLabel, onAction, onDismiss, dismissLabel }: BannerProps) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const tc = toneColors(t.color, tone);
  return (
    <View
      accessibilityLiveRegion={tone === "danger" ? "assertive" : "polite"}
      style={{
        flexDirection: "row",
        gap: t.space.md,
        padding: t.space.md,
        borderRadius: t.radius.md,
        backgroundColor: tc.bg,
        borderLeftWidth: 3,
        borderLeftColor: tc.solid,
      }}
    >
      <View style={{ paddingTop: 2 }}>
        <Icon name={icon ?? DEFAULT_ICON[tone]} color={tc.fg} />
      </View>
      <View style={{ flex: 1, gap: t.space.xs }}>
        {title && (
          <Text variant="headline" style={{ color: tc.fg }}>
            {title}
          </Text>
        )}
        <Text variant="callout" color="primary">
          {message}
        </Text>
        {actionLabel && onAction && (
          <View style={{ alignSelf: "flex-start", marginLeft: -t.space.md }}>
            <Button label={actionLabel} variant="ghost" size="sm" onPress={onAction} />
          </View>
        )}
      </View>
      {onDismiss && (
        <IconButton icon="x" size="sm" label={dismissLabel ?? tr("ui.dismiss")} onPress={onDismiss} style={{ marginTop: -6, marginRight: -6 }} />
      )}
    </View>
  );
}
