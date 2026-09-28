import React from "react";
import { View } from "react-native";
import { toneColors, useTokens } from "../theme";
import { Button } from "./Button";
import { Icon, IconName } from "./Icon";
import { Text } from "./Text";

export interface EmptyStateProps {
  title: string;
  body?: string;
  /** The raw technical text of an error, small and selectable under the body (never the body itself, Prism FL-11). */
  detail?: string;
  icon?: IconName;
  /** `error` turns this into the ErrorState (danger icon well). */
  tone?: "neutral" | "error";
  actionLabel?: string;
  onAction?: () => void;
  /** "secondary" where the screen's one accent belongs to another control (the chat's send). Default primary. */
  actionVariant?: "primary" | "secondary";
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** Empty and error states: what happened, why, and the one action that moves forward. */
export function EmptyState({
  title,
  body,
  detail,
  icon,
  tone = "neutral",
  actionLabel,
  onAction,
  actionVariant = "primary",
  secondaryLabel,
  onSecondary,
}: EmptyStateProps) {
  const t = useTokens();
  const tc = toneColors(t.color, tone === "error" ? "danger" : "neutral");
  return (
    <View style={{ alignItems: "center", paddingHorizontal: t.space.xl, paddingVertical: t.space.xxl, gap: t.space.md }}>
      <View
        style={{
          width: t.size.emptyWell,
          height: t.size.emptyWell,
          borderRadius: t.radius.full,
          backgroundColor: tc.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon ?? (tone === "error" ? "alert-triangle" : "inbox")} size="lg" color={tc.fg} />
      </View>
      <Text variant="title3" align="center" header>
        {title}
      </Text>
      {body && (
        <Text variant="callout" color="secondary" align="center">
          {body}
        </Text>
      )}
      {detail ? (
        <Text variant="caption" color="secondary" align="center" selectable>
          {detail}
        </Text>
      ) : null}
      {(actionLabel || secondaryLabel) && (
        <View style={{ gap: t.space.sm, marginTop: t.space.sm, alignSelf: "stretch", alignItems: "center" }}>
          {actionLabel && onAction && <Button label={actionLabel} variant={actionVariant} onPress={onAction} />}
          {secondaryLabel && onSecondary && <Button label={secondaryLabel} variant="ghost" onPress={onSecondary} />}
        </View>
      )}
    </View>
  );
}
