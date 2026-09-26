import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge, Button, Progress, Sheet, Text, useAnnounce, useToast } from "../components";
import type { Tone } from "../theme";
import { useTokens } from "../theme";
import type { CatalogModel } from "../../models/manifest";
import { formatBytes } from "./format";
import type { RowState, RowView } from "./modelRowState";

interface Props {
  model: CatalogModel;
  view: RowView;
  onDownload: () => void;
  onUse?: () => void;
  onRemove: () => Promise<void>;
  /** Another model is loading: Use waits. */
  busy?: boolean;
}

function badge(state: RowState, t: TFunction): { label: string; tone: Tone } | null {
  switch (state.kind) {
    case "not-installed":
      return null;
    case "downloading":
      return { label: t(state.phase === "copying" ? "flows.row.copying" : "flows.row.downloading"), tone: "info" };
    case "verifying":
      return { label: t("flows.row.verifying"), tone: "info" };
    case "loading":
      return { label: t("flows.row.loading"), tone: "info" };
    case "failed":
      return { label: t("flows.row.failed"), tone: "danger" };
    case "in-use":
      return { label: state.roles.map((r) => t(`flows.row.role.${r}`)).join(" · "), tone: "success" };
    case "installed":
      return state.verified
        ? { label: t("flows.row.verified"), tone: "field" }
        : { label: t("flows.row.unverified"), tone: "warning" };
  }
}

export function CatalogRow({ model, view, onDownload, onUse, onRemove, busy }: Props) {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const toast = useToast();
  const announce = useAnnounce();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { state } = view;
  const b = badge(state, t);
  const size = formatBytes(model.sizeBytes, i18n.language);
  const installed = state.kind === "installed" || state.kind === "in-use" || (state.kind === "failed" && state.errorKind === "load");
  const removable = !model.required && (installed || model.id.startsWith("hf-"));

  // Tell screen reader users when a row fails, once per failure.
  const lastKind = useRef(state.kind);
  useEffect(() => {
    if (state.kind === "failed" && lastKind.current !== "failed") {
      announce(t("flows.row.failedAnnounce", { name: model.label }), { assertive: true });
    }
    lastKind.current = state.kind;
  }, [state.kind, announce, model.label, t]);

  const progress =
    state.kind === "downloading" ? state.progress : state.kind === "verifying" ? state.progress ?? undefined : undefined;

  return (
    <View style={{ padding: tokens.space.base, gap: tokens.space.sm }}>
      <View style={{ gap: tokens.space.xxs }}>
        <Text variant="headline">{model.label}</Text>
        <Text variant="footnote" color="secondary">
          {[t(`flows.row.kind.${model.kind}`), size, model.license].join(" · ")}
        </Text>
      </View>
      {b && <Badge label={b.label} tone={b.tone} />}

      {(state.kind === "downloading" || state.kind === "verifying") && (
        <Progress
          label={t("flows.row.progressLabel", { name: model.label })}
          value={progress}
          valueText={progress != null ? `${Math.round(progress * 100)}%` : undefined}
        />
      )}

      {view.fitWarning && (
        <Text variant="footnote" color={view.fitWarning === "insufficient" ? "danger" : "warning"}>
          {t(`flows.row.fit.${view.fitWarning}`)}
        </Text>
      )}

      {state.kind === "failed" && (
        <View style={{ gap: tokens.space.xxs }}>
          <Text variant="footnote" color="danger">
            {t(`flows.row.error.${state.errorKind}`)}
          </Text>
          <Text variant="caption" color="tertiary" selectable>
            {state.message}
          </Text>
        </View>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm }}>
        {view.primary === "download" && (
          <Button size="sm" label={t("flows.row.download", { size })} icon="download" onPress={onDownload} />
        )}
        {view.primary === "retry" && (
          <Button
            size="sm"
            label={t("flows.row.retry")}
            icon="refresh-cw"
            onPress={state.kind === "failed" && state.errorKind === "load" ? onUse : onDownload}
          />
        )}
        {view.primary === "use" && onUse && (
          <Button size="sm" variant="secondary" label={t("flows.row.use")} onPress={onUse} disabled={busy} />
        )}
        {removable && (
          <Button
            size="sm"
            variant="ghost"
            label={t("flows.row.remove")}
            accessibilityHint={view.removeBlocked ? t("flows.row.inUseHint") : undefined}
            onPress={() => (view.removeBlocked ? toast({ message: t("flows.row.inUseHint") }) : setConfirmOpen(true))}
          />
        )}
      </View>

      <Sheet
        visible={confirmOpen}
        onClose={() => !removing && setConfirmOpen(false)}
        title={t("flows.row.removeTitle", { name: model.label })}
        description={t("flows.row.removeBody", { size })}
        footer={
          <>
            <Button label={t("common.cancel")} variant="secondary" fullWidth onPress={() => setConfirmOpen(false)} disabled={removing} />
            <Button
              label={t("flows.row.remove")}
              variant="destructive"
              fullWidth
              loading={removing}
              onPress={async () => {
                setRemoving(true);
                try {
                  await onRemove();
                  setConfirmOpen(false);
                  toast({ message: t("flows.row.removed", { name: model.label }), tone: "success" });
                } finally {
                  setRemoving(false);
                }
              }}
            />
          </>
        }
      />
    </View>
  );
}
