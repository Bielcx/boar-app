import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { impact, ImpactFeedbackStyle } from "../services/haptics";
import { llamaEngine } from "../inference/LlamaEngine";
import { getRoutingPreset } from "../models/settings";
import type { CatalogModel } from "../models/manifest";
import { EVAL_SET, EVAL_SET_VERSION } from "../eval/evalSet";
import { EvalConfig, evalConfigId, EvalResultRow } from "../eval/evalHarness.pure";
import { exportEvalResults, listInstalledEvalModels, runEvaluation, EvalProgress, EvaluationRun } from "../eval/evalHarness";
import { runDeviceEvalRequest } from "../eval/deviceEvalRequest";
import type { EvalRequest } from "../eval/deviceEvalRequest.pure";
import { resultsSharingAvailable, shareDevice, shareEvalRun } from "../eval/shareResults";
import type { ShareDevice, ShareResult } from "../eval/shareResults.pure";
import { SharePreview } from "./SharePreview";
import appConfig from "../../app.json";
import { Button, IconSlot, Progress, Screen, Section, Skeleton, Text, useOpticalLine, useToast } from "./components";
import { ScreenTitle } from "./flows/ScreenTitle";
import { screenRhythm } from "./flows/rhythm";
import type { TextColor } from "./components";
import { icon, useTokens } from "./theme";
import { useMotion } from "./theme/motion";
import { userErrorKey } from "./flows/userError";

interface Props {
  /** Shown as a Done button when the screen is opened outside the navigation stack (device requests). */
  onClose?: () => void;
  /** A chat reply is still generating — running an evaluation now would fight it for the model. */
  chatBusy?: boolean;
  /** Sent from a development machine (scripts/eval-device.mjs): runs immediately with its own selection. */
  deviceRequest?: EvalRequest;
}

function formatMs(ms: number | undefined): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function outcomeColor(outcome: EvalResultRow["outcome"]): TextColor {
  if (outcome === "failure") return "danger";
  if (outcome === "cancelled") return "warning";
  return "success";
}

/**
 * Runs the fixed evaluation set (src/eval/evalSet.ts) against selected
 * configurations and exports the structured results. See
 * docs/EVAL_QUERIES.md for the workflow.
 */
export function EvaluationScreen({ onClose, chatBusy, deviceRequest }: Props) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const bodyLine = useOpticalLine("body");
  const toast = useToast();
  const [models, setModels] = useState<CatalogModel[] | null>(null);
  const [preset, setPreset] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<EvalProgress | null>(null);
  const [rows, setRows] = useState<EvalResultRow[]>([]);
  const [run, setRun] = useState<EvaluationRun | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const motion = useMotion();
  const [sharing, setSharing] = useState(false);
  const [shared, setShared] = useState<string | null>(null);
  const [previewDevice, setPreviewDevice] = useState<ShareDevice | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    (async () => {
      const [installed, p] = await Promise.all([listInstalledEvalModels(), getRoutingPreset()]);
      setModels(installed);
      setPreset(p);
      setSelected(new Set([...installed.map((m) => `model:${m.id}`), "adaptive"]));
    })();
  }, []);

  const configs: EvalConfig[] = [
    // The model's real name, not its role ("Fast"): it is saved with every answer and shared with other phones.
    ...(models ?? []).map((m): EvalConfig => ({ kind: "model", modelId: m.id, label: m.label })),
    { kind: "adaptive", label: t("evaluation.adaptiveConfig", { preset }) },
  ];
  const chosen = configs.filter((c) => selected.has(evalConfigId(c)));

  const toggle = (id: string) => {
    if (running) return;
    impact(ImpactFeedbackStyle.Light);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRun = async () => {
    impact(ImpactFeedbackStyle.Medium);
    stopRef.current = false;
    setRunning(true);
    setStopping(false);
    setRows([]);
    setRun(null);
    const callbacks = {
      onProgress: setProgress,
      onRow: (row: EvalResultRow) => setRows((prev) => [...prev, row]),
      shouldStop: () => stopRef.current,
    };
    try {
      const result = deviceRequest
        ? await runDeviceEvalRequest(deviceRequest, (p) => t("evaluation.adaptiveConfig", { preset: p }), callbacks)
        : await runEvaluation({ configs: chosen, ...callbacks });
      setRun(result);
    } catch (e: any) {
      toast({ message: `${t("evaluation.runFailedTitle")}: ${t(userErrorKey(e))}`, tone: "danger" });
    } finally {
      setRunning(false);
      setStopping(false);
      setProgress(null);
    }
  };

  const handleStop = async () => {
    impact(ImpactFeedbackStyle.Medium);
    stopRef.current = true;
    setStopping(true);
    await llamaEngine.stop();
  };

  const handleExport = async (format: "jsonl" | "csv") => {
    if (!run) return;
    impact(ImpactFeedbackStyle.Light);
    try {
      await exportEvalResults(run, format);
    } catch (e: any) {
      toast({ message: `${t("evaluation.exportFailedTitle")}: ${t(userErrorKey(e))}`, tone: "danger" });
    }
  };

  // Nothing leaves the phone until the user has seen everything that will be sent (SharePreview)
  // and pressed Share there.
  const handleShare = () => {
    if (!run || run.rows.length === 0) return;
    impact(ImpactFeedbackStyle.Light);
    setPreviewDevice(shareDevice());
  };

  const confirmShare = async () => {
    if (!run) return;
    setSharing(true);
    let result: ShareResult = "failed";
    try {
      result = await shareEvalRun(run.rows);
    } catch {
      // e.g. the install id couldn't be saved; reported as a failed share below.
    } finally {
      setSharing(false);
    }
    setPreviewDevice(null);
    if (result === "shared" || result === "already-shared") setShared(run.runId);
    toast({ message: t(`evaluation.shareResult.${result}`), tone: result === "shared" || result === "already-shared" ? "success" : "danger" });
  };

  const canRun = !running && !chatBusy && chosen.length > 0 && models !== null;

  const autoStarted = useRef(false);
  useEffect(() => {
    if (deviceRequest && models !== null && !autoStarted.current) {
      autoStarted.current = true;
      handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceRequest, models]);

  return (
    // The flow screens' 14 pt rhythm, like its siblings (Prism FL-29).
    <Screen contentStyle={screenRhythm(tokens)}>
      {!onClose && <ScreenTitle>{t("flows.performance.evaluationTitle")}</ScreenTitle>}
      <View style={{ gap: tokens.space.xs }}>
        {onClose && !running && (
          <Button size="sm" variant="ghost" label={t("common.done")} onPress={onClose} style={{ alignSelf: "flex-end" }} />
        )}
        <Text variant="callout" color="secondary">
          {t("evaluation.subtitle", { version: EVAL_SET_VERSION, count: EVAL_SET.length })}
        </Text>
        {deviceRequest && (
          <Text variant="footnote" color="secondary">
            {t("evaluation.deviceRequest", { id: deviceRequest.requestId })}
          </Text>
        )}
      </View>

      {!deviceRequest && (
        <Section title={t("evaluation.configsTitle")}>
          {models === null ? (
            <View style={{ padding: tokens.space.base }}>
              <Skeleton height={tokens.size.row} />
            </View>
          ) : (
            <>
              {models.length === 0 && (
                <View style={{ padding: tokens.space.base }}>
                  <Text variant="callout" color="secondary">
                    {t("evaluation.noModels")}
                  </Text>
                </View>
              )}
              {configs.map((c) => {
                const id = evalConfigId(c);
                const on = selected.has(id);
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: running }}
                    accessibilityLabel={c.label}
                    onPress={() => toggle(id)}
                    style={{ minHeight: tokens.size.row, paddingHorizontal: tokens.space.base, paddingVertical: tokens.space.md, flexDirection: "row", alignItems: "flex-start", gap: icon.gap }}
                  >
                    <IconSlot name={on ? "check-square" : "square"} line={bodyLine} color={on ? tokens.color.accent.text : tokens.color.text.secondary} />
                    <Text variant="body" style={{ flex: 1 }}>
                      {c.label}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          )}
        </Section>
      )}

      <View style={{ gap: tokens.space.sm }}>
        {!deviceRequest && (
          <Text variant="footnote" color="secondary">
            {t("evaluation.summary", { queries: EVAL_SET.length, configs: chosen.length, total: EVAL_SET.length * chosen.length })}
          </Text>
        )}
        <Text variant="footnote" color={chatBusy ? "warning" : "secondary"}>
          {chatBusy ? t("evaluation.chatBusy") : t("evaluation.keepScreenOn")}
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: tokens.space.sm }}>
          {running ? (
            <Button variant="destructive" icon="square" label={stopping ? t("evaluation.stopping") : t("evaluation.stop")} onPress={handleStop} disabled={stopping} />
          ) : (
            <Button label={t("evaluation.run")} icon="play" onPress={handleRun} disabled={!canRun} />
          )}
          {run && !running && (
            <>
              <Button size="sm" variant="secondary" icon="share" label={t("evaluation.exportJsonl")} onPress={() => handleExport("jsonl")} />
              <Button size="sm" variant="secondary" icon="share" label={t("evaluation.exportCsv")} onPress={() => handleExport("csv")} />
              {resultsSharingAvailable && (
                <Button
                  size="sm"
                  icon="upload"
                  label={sharing ? t("evaluation.sharing") : shared === run.runId ? t("evaluation.shared") : t("evaluation.share")}
                  onPress={handleShare}
                  disabled={sharing || shared === run.runId}
                />
              )}
            </>
          )}
        </View>
      </View>

      {progress && (
        <View style={{ gap: tokens.space.xs }}>
          <Progress
            label={t("evaluation.title")}
            value={(progress.configIndex * progress.queryCount + progress.queryIndex) / (progress.configCount * progress.queryCount)}
            valueText={t("evaluation.progress", {
              config: progress.configIndex + 1,
              configs: progress.configCount,
              query: progress.queryIndex + 1,
              queries: progress.queryCount,
            })}
          />
          <Text variant="footnote" color="secondary">
            {t("evaluation.progress", {
              config: progress.configIndex + 1,
              configs: progress.configCount,
              query: progress.queryIndex + 1,
              queries: progress.queryCount,
            })}
          </Text>
          <Text variant="footnote" color="secondary" numberOfLines={2}>
            {progress.config.label} — {progress.query.query}
          </Text>
        </View>
      )}

      {run && (
        <Text variant="footnote" color="secondary" selectable>
          {run.stopped ? `${t("evaluation.stoppedEarly")} ` : ""}
          {t("evaluation.savedTo", { path: run.savedPath })}
        </Text>
      )}

      {rows.length > 0 && (
        <Section>
          {rows.map((r) => {
            const key = `${r.configId}/${r.queryId}`;
            const open = expanded === key;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${r.queryId}, ${r.configLabel}, ${r.outcome ?? ""}`}
                onPress={() => {
                  motion.animateNextLayout();
                  setExpanded(open ? null : key);
                }}
                style={{ padding: tokens.space.base, gap: tokens.space.xxs }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: tokens.space.sm }}>
                  <Text variant="subhead" numberOfLines={1} style={{ flex: 1 }}>
                    {r.queryId} · {r.configLabel}
                  </Text>
                  <Text variant="caption" color={outcomeColor(r.outcome)} weight="semibold">
                    {(r.outcome ?? "—").toUpperCase()}
                  </Text>
                </View>
                <Text variant="caption" color="secondary">
                  {r.modelId ?? "—"} · {r.taskType ?? "—"} · {r.modelResidency ?? "—"} ·{" "}
                  {r.retrievalUsed ? r.retrievedTitles.slice(0, 2).join(", ") : t("evaluation.noRetrieval")}
                </Text>
                <Text variant="caption" color="secondary" numeric>
                  {r.tokPerSec ? `${r.tokPerSec.toFixed(1)} t/s` : "—"} · load {formatMs(r.modelLoadMs)} · TTFT {formatMs(r.ttftMs)} · total{" "}
                  {formatMs(r.totalLatencyMs)}
                </Text>
                <Text variant="footnote" numberOfLines={open ? undefined : 3}>
                  {r.errorMessage && r.outcome === "failure" ? r.errorMessage : r.answer}
                </Text>
              </Pressable>
            );
          })}
        </Section>
      )}
      {run && previewDevice && (
        <SharePreview
          visible
          rows={run.rows}
          device={previewDevice}
          appVersion={appConfig.expo.version}
          sending={sharing}
          onCancel={() => setPreviewDevice(null)}
          onShare={confirmShare}
        />
      )}
    </Screen>
  );
}
