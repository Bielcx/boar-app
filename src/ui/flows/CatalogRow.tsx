import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge, Button, IconName, MetaLine, Progress, Sheet, Text, useAnnounce, useToast } from "../components";
import type { Tone } from "../theme";
import { useTokens } from "../theme";
import type { CatalogModel } from "../../models/manifest";
import { formatBytes, formatRam } from "./format";
import type { RowState, RowView } from "./modelRowState";
import type { MemoryFit } from "../../inference/memoryFit";
import { canDownload } from "./useCatalog";
import type { FileImport } from "./useCatalog";

interface Props {
  model: CatalogModel;
  view: RowView;
  onDownload: () => void;
  onUse?: () => void;
  onRemove: () => Promise<void>;
  /** Another model is loading: Use waits. */
  busy?: boolean;
  /** Overrides the catalog label (e.g. a translated region name). */
  title?: string;
  /** Replaces the license line (the size always sits on the right of the name). */
  meta?: string;
  /** Extra lines under the meta line (e.g. cities covered). */
  details?: string[];
  /** Memory estimate, for the numbers in the "won't fit" explanation. */
  fit?: MemoryFit;
  /** The kind overline; off where the whole screen is one kind (Knowledge, Prism KN-3). */
  showKind?: boolean;
  /** The file this row asked for (useCatalog.importFor): its check, refusal or mismatch shows here. */
  fileImport?: FileImport;
}

type Seal = { label: string; tone: Tone; emphasis: "solid" | "soft" | "outline"; icon?: IconName };

/** Status seal per state (Fogueira & Luar): ACTIVE solid, CACHED soft, DOWNLOADING outline with loader, NOT ON DISK outline. */
function seal(state: RowState, t: TFunction): Seal {
  switch (state.kind) {
    case "not-installed":
      return { label: t("flows.row.notOnDisk"), tone: "neutral", emphasis: "outline" };
    case "downloading":
      return { label: t(state.phase === "copying" ? "flows.row.copying" : "flows.row.downloading"), tone: "field", emphasis: "outline", icon: "loader" };
    case "verifying":
      return { label: t("flows.row.verifying"), tone: "field", emphasis: "outline", icon: "loader" };
    case "loading":
      return { label: t("flows.row.loading"), tone: "field", emphasis: "outline", icon: "loader" };
    case "failed":
      return { label: t("flows.row.failed"), tone: "danger", emphasis: "soft" };
    case "in-use":
      return { label: state.roles.map((r) => t(`flows.row.role.${r}`)).join(" · "), tone: "accent", emphasis: "solid" };
    case "installed":
      return state.verified
        ? { label: t("flows.row.verified"), tone: "field", emphasis: "soft" }
        : { label: t("flows.row.unverified"), tone: "warning", emphasis: "soft" };
  }
}

const FIT_TONE: Record<string, Tone> = { resident: "success", streaming: "warning", thrashing: "warning", insufficient: "danger" };

export function CatalogRow({ model, view, onDownload, onUse, onRemove, busy, title, meta, details, fit, showKind = true, fileImport }: Props) {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const toast = useToast();
  const announce = useAnnounce();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { state } = view;
  const b = seal(state, t);
  const size = formatBytes(model.sizeBytes, i18n.language);
  // No network in this build, or no published URL yet: the item comes in as a file.
  const offline = !canDownload(model);
  const getLabel = offline ? t("flows.row.importFile", { size }) : t("flows.row.download", { size });
  const getIcon = offline ? ("file-plus" as const) : ("download" as const);
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
      {/* The mockup's catalog card: kind overline and status seal, then the name with its size, then one metadata line. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.sm }}>
        <View style={{ flex: 1 }}>
          {showKind && (
            <Text variant="label" color="field">
              {t(`flows.row.kind.${model.kind}`)}
            </Text>
          )}
        </View>
        <Badge label={b.label} tone={b.tone} emphasis={b.emphasis} icon={b.icon} />
      </View>
      <View style={{ gap: tokens.space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: tokens.space.md }}>
          <Text variant="headline" style={{ flex: 1 }}>
            {title ?? model.label}
          </Text>
          <Text variant="headline" numeric>
            {size}
          </Text>
        </View>
        <MetaLine items={meta ? [meta] : [model.license]} />
        {details?.map((d) => (
          <Text key={d} variant="footnote" color="secondary">
            {d}
          </Text>
        ))}
      </View>
      {view.fitWarning && (
        <View style={{ flexDirection: "row" }}>
          <Badge label={t(`flows.row.fitShort.${view.fitWarning}`)} tone={FIT_TONE[view.fitWarning]} dot caps={false} />
        </View>
      )}

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
          <Text variant="caption" color="secondary" selectable>
            {state.message}
          </Text>
        </View>
      )}

      {fileImport && (
        <View style={{ gap: tokens.space.xs }} accessibilityLiveRegion="polite">
          {fileImport.status === "importing" ? (
            <>
              <Text variant="footnote" color="secondary">
                {t("flows.row.importChecking", { name: fileImport.name })}
              </Text>
              <Progress label={t("flows.row.importChecking", { name: fileImport.name })} value={fileImport.progress} />
            </>
          ) : fileImport.status === "failed" ? (
            <Text variant="footnote" color="danger">
              {`${fileImport.name}: ${t(`flows.row.error.${fileImport.errorKind ?? "unknown"}`)}`}
            </Text>
          ) : (
            <Text variant="footnote" color="warning">
              {t("flows.row.importOther", { name: fileImport.name })}
            </Text>
          )}
        </View>
      )}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm }}>
        {view.primary === "download" && (
          <Button size="sm" label={getLabel} icon={getIcon} onPress={onDownload} />
        )}
        {view.primary === "explain" && (
          <Button
            size="sm"
            variant="secondary"
            label={getLabel}
            icon={getIcon}
            accessibilityHint={t("flows.row.fit.insufficient")}
            onPress={() => setExplainOpen(true)}
          />
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
            tone="danger"
            label={t("flows.row.remove")}
            accessibilityHint={view.removeBlocked ? t("flows.row.inUseHint") : undefined}
            onPress={() => (view.removeBlocked ? toast({ message: t("flows.row.inUseHint") }) : setConfirmOpen(true))}
          />
        )}
      </View>

      <Sheet
        visible={explainOpen}
        onClose={() => setExplainOpen(false)}
        title={t("flows.row.wontFitTitle", { name: model.label })}
        description={t("flows.row.fit.insufficient")}
        footer={
          <>
            <Button label={t("common.cancel")} variant="secondary" fullWidth onPress={() => setExplainOpen(false)} />
            <Button
              label={offline ? t("flows.row.importAnyway", { size }) : t("flows.row.downloadAnyway", { size })}
              variant="secondary"
              fullWidth
              onPress={() => {
                setExplainOpen(false);
                onDownload();
              }}
            />
          </>
        }
      >
        {fit && (
          <Text variant="callout" numeric>
            {t("flows.row.fitDetail", {
              need: formatRam(fit.anonBytes, i18n.language),
              free: formatRam(fit.availableBytes, i18n.language),
              total: formatRam(fit.totalBytes, i18n.language),
            })}
          </Text>
        )}
      </Sheet>

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
