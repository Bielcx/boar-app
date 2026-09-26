import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Badge, Button, EmptyState, ListRow, Progress, Screen, Section, Sheet, Skeleton, Text, useToast } from "./components";
import type { Tone } from "./theme";
import { useTokens } from "./theme";
import { MODEL_CATALOG, RAM_BUDGET_BYTES, STORAGE_BUDGET_BYTES } from "../models/manifest";
import {
  clearExecutionTelemetry,
  ExecutionTelemetryRecord,
  exportExecutionTelemetry,
  listRecentExecutions,
} from "../services/executionTelemetry";
import { getAppPeakRssBytes } from "../services/telemetry";
import { PerfBand, PERF_BANDS_PROVISIONAL, recordTokPerSec, summarizeRecent, tokPerSecBand, ttftBand } from "./flows/perfBands";
import { useCatalog } from "./flows/useCatalog";
import { formatBytes, formatRate, formatSeconds } from "./flows/format";
import type { RootStackParamList } from "./navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

const BAND_TONE: Record<PerfBand, Tone> = { fast: "success", ok: "neutral", slow: "warning" };

function useRecords() {
  const [records, setRecords] = useState<ExecutionTelemetryRecord[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      setRecords(await listRecentExecutions(200));
    } catch {
      setError(true);
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  return { records, error, load, setRecords };
}

function Metric({ label, value, band }: { label: string; value: string; band?: PerfBand }) {
  const { t } = useTranslation();
  const tokens = useTokens();
  return (
    <View
      accessible
      accessibilityLabel={[label, value, band && t(`flows.performance.band.${band}`)].filter(Boolean).join(", ")}
      style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: tokens.space.sm, paddingVertical: tokens.space.xs }}
    >
      <Text variant="callout" color="secondary">
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.sm }}>
        <Text variant="headline" numeric>
          {value}
        </Text>
        {band && <Badge label={t(`flows.performance.band.${band}`)} tone={BAND_TONE[band]} />}
      </View>
    </View>
  );
}

function Meter({ label, used, total, text }: { label: string; used: number; total: number; text: string }) {
  const tokens = useTokens();
  return (
    <View style={{ gap: tokens.space.xs }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: tokens.space.sm }}>
        <Text variant="callout" color="secondary">
          {label}
        </Text>
        <Text variant="callout" numeric>
          {text}
        </Text>
      </View>
      <Progress label={label} value={Math.min(used / total, 1)} valueText={text} tone="field" />
    </View>
  );
}

export function PerformanceScreen() {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const navigation = useNavigation<Nav>();
  const catalog = useCatalog();
  const { refresh } = catalog;
  const { records, error, load } = useRecords();
  const lang = i18n.language;
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (error) {
    return (
      <Screen>
        <EmptyState tone="error" title={t("flows.performance.loadFailed")} actionLabel={t("flows.row.retry")} onAction={load} />
      </Screen>
    );
  }
  if (!records || !catalog.loaded) {
    return (
      <Screen>
        <View accessible accessibilityLabel={t("flows.common.loading")} style={{ gap: 12 }}>
          <Skeleton height={120} />
          <Skeleton height={120} />
        </View>
      </Screen>
    );
  }

  const last = records.find((r) => r.outcome === "success");
  const lastRate = last ? recordTokPerSec(last) : undefined;
  const typical = summarizeRecent(records);
  const modelLabel = (id?: string) => MODEL_CATALOG.find((m) => m.id === id)?.label ?? catalog.discovered.find((m) => m.id === id)?.label ?? id;

  const peakRss = getAppPeakRssBytes();
  let models = 0;
  let knowledge = 0;
  for (const s of Object.values(catalog.statuses)) {
    if (!s.present) continue;
    if (s.asset.kind === "corpus") knowledge += s.sizeOnDiskBytes;
    else models += s.sizeOnDiskBytes;
  }

  return (
    <Screen>
      {PERF_BANDS_PROVISIONAL && (
        <Text variant="footnote" color="tertiary">
          {t("flows.performance.provisional")}
        </Text>
      )}

      <Section title={t("flows.performance.lastAnswer")}>
        <View style={{ padding: tokens.space.base, gap: tokens.space.xs }}>
          {last ? (
            <>
              {last.ttftMs != null && (
                <Metric label={t("flows.performance.ttft")} value={formatSeconds(last.ttftMs, lang)} band={ttftBand(last.ttftMs)} />
              )}
              {lastRate != null && (
                <Metric
                  label={t("flows.performance.speed")}
                  value={t("flows.performance.rate", { rate: formatRate(lastRate, lang) })}
                  band={tokPerSecBand(lastRate)}
                />
              )}
              {last.totalLatencyMs != null && <Metric label={t("flows.performance.total")} value={formatSeconds(last.totalLatencyMs, lang)} />}
              <Text variant="footnote" color="tertiary">
                {[modelLabel(last.modelId), last.retrievalUsed ? t("flows.performance.usedSources") : t("flows.performance.noSources")]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </>
          ) : (
            <Text variant="callout" color="secondary">
              {t("flows.performance.empty")}
            </Text>
          )}
        </View>
      </Section>

      {typical.sampleSize > 1 && (
        <Section title={t("flows.performance.typical", { count: typical.sampleSize })} footer={t("flows.performance.typicalFooter")}>
          <View style={{ padding: tokens.space.base, gap: tokens.space.xs }}>
            {typical.ttftMs != null && (
              <Metric label={t("flows.performance.ttft")} value={formatSeconds(typical.ttftMs, lang)} band={ttftBand(typical.ttftMs)} />
            )}
            {typical.tokPerSec != null && (
              <Metric
                label={t("flows.performance.speed")}
                value={t("flows.performance.rate", { rate: formatRate(typical.tokPerSec, lang) })}
                band={tokPerSecBand(typical.tokPerSec)}
              />
            )}
            {typical.totalLatencyMs != null && <Metric label={t("flows.performance.total")} value={formatSeconds(typical.totalLatencyMs, lang)} />}
          </View>
        </Section>
      )}

      <Section title={t("flows.performance.fits")} footer={t("flows.performance.fitsFooter", { ram: formatBytes(RAM_BUDGET_BYTES, lang), storage: formatBytes(STORAGE_BUDGET_BYTES, lang) })}>
        <View style={{ padding: tokens.space.base, gap: tokens.space.base }}>
          {peakRss > 0 && (
            <Meter
              label={t("flows.performance.memory")}
              used={peakRss}
              total={RAM_BUDGET_BYTES}
              text={t("flows.performance.ofLimit", { used: formatBytes(peakRss, lang), limit: formatBytes(RAM_BUDGET_BYTES, lang) })}
            />
          )}
          <Meter
            label={t("flows.performance.storage")}
            used={models + knowledge}
            total={STORAGE_BUDGET_BYTES}
            text={t("flows.performance.ofLimit", { used: formatBytes(models + knowledge, lang), limit: formatBytes(STORAGE_BUDGET_BYTES, lang) })}
          />
          <Text variant="footnote" color="secondary">
            {t("flows.performance.storageSplit", { models: formatBytes(models, lang), knowledge: formatBytes(knowledge, lang) })}
          </Text>
          {catalog.deviceRamBytes > 0 && (
            <Text variant="footnote" color="secondary">
              {t("flows.performance.deviceRam", { ram: formatBytes(catalog.deviceRamBytes, lang) })}
            </Text>
          )}
        </View>
      </Section>

      <Section title={t("flows.models.advanced")}>
        <ListRow icon="list" title={t("flows.performance.logsTitle")} value={String(records.length)} onPress={() => navigation.navigate("PerformanceLogs")} />
        <ListRow icon="check-square" title={t("flows.performance.evaluationTitle")} subtitle={t("flows.performance.evaluationSub")} onPress={() => navigation.navigate("Evaluation")} />
      </Section>
    </Screen>
  );
}

function residencyKey(r: ExecutionTelemetryRecord): string {
  return `flows.performance.residency.${r.modelResidency ?? "unknown"}`;
}

export function PerformanceLogsScreen() {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const toast = useToast();
  const { records, error, load, setRecords } = useRecords();
  const [exporting, setExporting] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const lang = i18n.language;

  const doExport = async (format: "json" | "csv") => {
    setExporting(true);
    try {
      await exportExecutionTelemetry(format);
    } catch (e: any) {
      toast({ message: t("flows.performance.exportFailed", { error: e?.message ?? String(e) }), tone: "danger" });
    } finally {
      setExporting(false);
    }
  };

  if (error) {
    return (
      <Screen>
        <EmptyState tone="error" title={t("flows.performance.loadFailed")} actionLabel={t("flows.row.retry")} onAction={load} />
      </Screen>
    );
  }
  if (!records) {
    return (
      <Screen>
        <Skeleton height={80} />
      </Screen>
    );
  }
  if (records.length === 0) {
    return (
      <Screen>
        <EmptyState icon="activity" title={t("flows.performance.logsEmpty")} body={t("flows.performance.empty")} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm }}>
        <Button size="sm" variant="secondary" icon="share" label={t("flows.performance.exportJson")} loading={exporting} onPress={() => doExport("json")} />
        <Button size="sm" variant="secondary" icon="share" label={t("flows.performance.exportCsv")} disabled={exporting} onPress={() => doExport("csv")} />
        <Button size="sm" variant="ghost" label={t("flows.performance.clear")} onPress={() => setClearOpen(true)} />
      </View>
      <Section>
        {records.map((r) => {
          const rate = recordTokPerSec(r);
          const parts = [
            r.ttftMs != null && `TTFT ${formatSeconds(r.ttftMs, lang)}`,
            rate != null && t("flows.performance.rate", { rate: formatRate(rate, lang) }),
            r.totalLatencyMs != null && `${t("flows.performance.total")} ${formatSeconds(r.totalLatencyMs, lang)}`,
            r.peakRssBytes != null && `RSS ${formatBytes(r.peakRssBytes, lang)}`,
            r.modelLoadMs != null && `${t("flows.performance.load")} ${formatSeconds(r.modelLoadMs, lang)}`,
          ].filter(Boolean);
          return (
            <ListRow
              key={r.id}
              title={r.modelId ?? t("flows.performance.noModel")}
              value={t(`flows.performance.outcome.${r.outcome ?? "success"}`)}
              subtitle={[parts.join(" · "), [r.taskType, t(residencyKey(r)), new Date(r.createdAt).toLocaleString(lang)].filter(Boolean).join(" · ")].join("\n")}
            />
          );
        })}
      </Section>

      <Sheet
        visible={clearOpen}
        onClose={() => setClearOpen(false)}
        title={t("flows.performance.clearTitle")}
        description={t("flows.performance.clearBody")}
        footer={
          <>
            <Button label={t("common.cancel")} variant="secondary" fullWidth onPress={() => setClearOpen(false)} />
            <Button
              label={t("flows.performance.clear")}
              variant="destructive"
              fullWidth
              onPress={async () => {
                await clearExecutionTelemetry();
                setClearOpen(false);
                setRecords([]);
              }}
            />
          </>
        }
      />
    </Screen>
  );
}
