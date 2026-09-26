import React from "react";
import { Platform, Switch as RNSwitch } from "react-native";
import { selection } from "../../services/haptics";
import { useTokens } from "../theme";

export interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** The row text this switch controls (read as the switch's name, not "on/off"). */
  label: string;
  disabled?: boolean;
}

/** Native switch with theme colors. Use only for settings that take effect immediately. */
export function Switch({ value, onValueChange, label, disabled }: SwitchProps) {
  const t = useTokens();
  return (
    <RNSwitch
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        selection();
        onValueChange(next);
      }}
      trackColor={{ false: t.color.line.strong, true: t.color.accent.solid }}
      ios_backgroundColor={t.color.line.strong}
      thumbColor={Platform.OS === "android" ? t.color.bg.raised : undefined}
    />
  );
}
