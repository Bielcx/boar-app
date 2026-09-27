import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Badge, Button, IconName, MetaLine, Progress, Sheet, Text, TextAction, useAnnounce, useOpticalLine, useToast } from "../components";
import type { Tone } from "../theme";
import { useTokens } from "../theme";
import type { CatalogModel } from "../../models/manifest";
import { failureLines, formatBytes, formatRam } from "./format";
import { catalogLabel } from "./catalogLabel";
import type { RowState, RowView } from "./modelRowState";
import type { MemoryFit } from "../../inference/memoryFit";
import { canDownload } from "./useCatalog";
import { confirmLargeModel } from "./adapters";
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
      // A solid seal is a status (Active); the role goes in the metadata, the kind is already the overline (Iris).
      // Amber (field) = on the phone and in use; ember stays for the one selection on the screen (Iris P2-6).
      return { label: t("flows.row.active"), tone: "field", emphasis: "solid" };
    case "installed":
      return state.verified
        ? { label: t("flows.row.verified"), tone: "field", emphasis: "soft" }
        : { label: t("flows.row.unverified"), tone: "warning", emphasis: "soft" };
  }
}

/** A detail line longer than this may wrap past two lines: it folds, with Show all. */
const DETAIL_FOLD_CHARS = 90;

const FIT_TONE: Record<string, Tone> = { resident: "success", streaming: "warning", thrashing: "warning", insufficient: "danger" };

export function CatalogRow({ model, view, onDownload, onUse, onRemove, busy, title, meta, details, fit, showKind = true, fileImport }: Props) {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const toast = useToast();
  const announce = useAnnounce();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [explainOpen, setExplainOpen] = useState(false);
  const [closeRiskOpen, setCloseRiskOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // On a low-RAM phone, a model bigger than the compact one asks before loading (CR-1).
  const requestUse = onUse && (view.confirmUse ? () => setCloseRiskOpen(true) : onUse);
  // A ghost Remove that opens the actions row lines its text up with the column above (Iris).
  const leadsActions = !(view.primary === "download" || view.primary === "explain" || view.primary === "retry" || (view.primary === "use" && onUse));
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
      announce(t("flows.row.failedAnnounce", { name: catalogLabel(model, t) }), { assertive: true });
    }
    lastKind.current = state.kind;
  }, [state.kind, announce, catalogLabel(model, t), t]);

  const metaLine = useOpticalLine("mono");
  const progress =
    state.kind === "downloading" ? state.progress : state.kind === "verifying" ? state.progress ?? undefined : undefined;

  return (
    // 14 pt inset like the mockup's lists and the Section/ListRow (Iris dfe6950).
    <View style={{ padding: tokens.space.md + tokens.space.xxs, gap: tokens.space.sm }}>
      {/* The mockup's catalog card: kind overline and status seal, then the name with its size, then one metadata line. */}
      {showKind && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.sm }}>
          <Text variant="label" color="field" style={{ flex: 1 }}>
            {t(`flows.row.kind.${model.kind}`)}
          </Text>
          <Badge label={b.label} tone={b.tone} emphasis={b.emphasis} icon={b.icon} />
        </View>
      )}
      <View style={{ gap: tokens.space.xs }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: tokens.space.md }}>
          <Text variant="headline" style={{ flex: 1 }}>
            {title ?? catalogLabel(model, t)}
          </Text>
          <Text variant="headline" numeric>
            {size}
          </Text>
        </View>
        {/* Without the kind overline, the seal sits on the metadata line, not alone above the title (Prism KN-6). */}
        {/* flex-start + a one-line slot: the seal stays on the metadata's FIRST line when it wraps (icon-align rule 1). */}
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: tokens.space.sm }}>
          <View style={{ flex: 1 }}>
            <MetaLine
              items={[
                state.kind === "in-use" && t("flows.row.usedFor", { roles: state.roles.map((r) => t(`flows.row.role.${r}`)).join(", ") }),
                // The seal says "May be slow"; the metadata says why, once (Iris, Prism MD-3).
                view.wontFit
              ? fit
                ? t("flows.row.wontFitNumbers", {
                    // What it needs: weights and working memory for a dense model, the working memory alone for MoE.
                    need: formatRam(fit.expertFraction === 0 ? fit.fileBytes + fit.anonBytes : fit.anonBytes, i18n.language),
                    total: formatRam(fit.totalBytes, i18n.language),
                  })
                : t("flows.row.wontFitWhy")
              : view.mayCloseApp
                ? t("flows.row.mayCloseWhy")
                : view.fitWarning && t(`flows.row.fitWhy.${view.fitWarning}`),
                meta ?? model.license,
              ]}
            />
          </View>
          {!showKind && (
            <View style={{ height: metaLine.lineHeight, justifyContent: "center" }}>
              <Badge label={b.label} tone={b.tone} emphasis={b.emphasis} icon={b.icon} />
            </View>
          )}
        </View>
        {details?.map((d) => (
          // Long lines (a pack's sources) fold to two lines (Iris).
          <Text key={d} variant="footnote" color="secondary" numberOfLines={showAll ? undefined : 2}>
            {d}
          </Text>
        ))}
        {details?.some((d) => d.length > DETAIL_FOLD_CHARS) && (
          // A neutral text action: ember stays for the screen's one accent (Knowledge showed one per pack).
          <View style={{ alignSelf: "flex-start" }}>
            <TextAction
              label={t(showAll ? "flows.row.showLess" : "flows.row.showAll")}
              icon={showAll ? "chevron-up" : "chevron-down"}
              expanded={showAll}
              onPress={() => setShowAll((v) => !v)}
            />
          </View>
        )}
      </View>
      {view.wontFit ? (
        <View style={{ flexDirection: "row" }}>
          {/* A fixed fact about a model that can't be chosen, not a risk: neutral outline, like NOT ON DISK (Iris). */}
          <Badge label={t("flows.row.wontFitHere")} tone="neutral" emphasis="outline" />
        </View>
      ) : view.mayCloseApp ? (
        <View style={{ flexDirection: "row" }}>
          <Badge label={t(view.didNotOpen ? "flows.row.didNotOpen" : "flows.row.mayClose")} tone="danger" dot caps={false} />
        </View>
      ) : view.fitWarning ? (
        <View style={{ flexDirection: "row" }}>
          <Badge label={t(`flows.row.fitShort.${view.fitWarning}`)} tone={FIT_TONE[view.fitWarning]} dot caps={false} />
        </View>
      ) : null}

      {(state.kind === "downloading" || state.kind === "verifying") && (
        <Progress
          label={t("flows.row.progressLabel", { name: catalogLabel(model, t) })}
          value={progress}
          valueText={progress != null ? `${Math.round(progress * 100)}%` : undefined}
        />
      )}

      {state.kind === "failed" &&
        (() => {
          const lines = failureLines(state, t, i18n.language);
          return (
            <View style={{ gap: tokens.space.xxs }}>
              <Text variant="footnote" color="danger">
                {lines.cause}
              </Text>
              <Text variant="caption" color="secondary" selectable>
                {lines.detail}
              </Text>
            </View>
          );
        })()}

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
        {/* One primary per screen: a catalog row's action is secondary, the seal carries the state (Iris, Prism MD-2). */}
        {view.primary === "download" && (
          <Button size="sm" variant="secondary" label={getLabel} icon={getIcon} onPress={onDownload} />
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
            variant="secondary"
            label={t("flows.row.retry")}
            icon="refresh-cw"
            onPress={state.kind === "failed" && state.errorKind === "load" ? requestUse : onDownload}
          />
        )}
        {view.primary === "use" && onUse && (
          <Button size="sm" variant="secondary" label={t("flows.row.use")} onPress={requestUse} disabled={busy} />
        )}
        {removable && (
          <View style={leadsActions ? { marginLeft: -tokens.space.md } : undefined}>
          <Button
            size="sm"
            variant="ghost"
            tone="danger"
            label={t("flows.row.remove")}
            accessibilityHint={view.removeBlocked ? t("flows.row.inUseHint") : undefined}
            onPress={() => (view.removeBlocked ? toast({ message: t("flows.row.inUseHint") }) : setConfirmOpen(true))}
          />
          </View>
        )}
      </View>

      <Sheet
        visible={explainOpen}
        onClose={() => setExplainOpen(false)}
        title={t("flows.row.wontFitTitle", { name: catalogLabel(model, t) })}
        description={t("flows.row.fit.insufficient")}
        footer={
          <>
            <Button label={t("common.cancel")} variant="secondary" fullWidth onPress={() => setExplainOpen(false)} />
            <Button
              label={offline ? t("flows.row.importAnyway") : t("flows.row.downloadAnyway")}
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
        {/* The size and the risk sit here, so the button stays a verb (copy-wrap). */}
        <Text variant="footnote" color="secondary" numeric>
          {t("flows.row.anywayHint", { size })}
        </Text>
      </Sheet>

      <Sheet
        visible={closeRiskOpen}
        onClose={() => setCloseRiskOpen(false)}
        title={t("flows.row.mayCloseTitle")}
        footer={
          <>
            {/* Compact is the default here: the safe choice first (the Sheet stacks the footer bottom-up). */}
            <Button label={t("flows.row.keepCompact")} variant="primary" fullWidth onPress={() => setCloseRiskOpen(false)} />
            <Button
              label={t("flows.row.useAnyway")}
              variant="secondary"
              fullWidth
              onPress={async () => {
                setCloseRiskOpen(false);
                // Lets the engine load it on this low-RAM phone (Tusk's confirmLargeModel).
                await confirmLargeModel(model.id);
                onUse?.();
              }}
            />
          </>
        }
      >
        {/* A short title; the model's full name goes in the body, in bold (Iris). */}
        <Text variant="callout">
          {t(view.didNotOpen ? "flows.row.didNotOpenBefore" : "flows.row.mayCloseBefore")}
          <Text variant="callout" weight="semibold">
            {title ?? catalogLabel(model, t)}
          </Text>
          {t("flows.row.mayCloseAfter")}
        </Text>
      </Sheet>

      <Sheet
        visible={confirmOpen}
        onClose={() => !removing && setConfirmOpen(false)}
        title={t("flows.row.removeTitle", { name: catalogLabel(model, t) })}
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
                  toast({ message: t("flows.row.removed", { name: catalogLabel(model, t) }), tone: "success" });
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
