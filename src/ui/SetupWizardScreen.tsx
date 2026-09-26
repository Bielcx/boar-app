/**
 * First-run setup in three steps: welcome → capacity package → install and
 * index. Every number shown is measured on the device or computed from the
 * manifest (flows-spec §4.1); nothing is typed in by hand.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, AppState, BackHandler, findNodeHandle, Image, Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Badge, Button, EmptyState, Icon, IconName, Progress, Screen, SegmentedControl, Sheet, Text, useAnnounce } from "./components";
import { useTokens } from "./theme";
import { impact, ImpactFeedbackStyle, notification, NotificationFeedbackType } from "../services/haptics";
import { useLanguage } from "../i18n/LanguageContext";
import { LanguageId } from "../models/settings";
import { CatalogModel, MODEL_CATALOG, TIERS } from "../models/manifest";
import { restartDownload } from "../services/downloadManager";
import { onSeedProgress, seedKnowledgeBaseIfEmpty, SeedProgress } from "../rag/seedCorpus";
import { embeddingEngine } from "../rag/embed";
import { useCatalog } from "./flows/useCatalog";
import { fitFor } from "./flows/adapters";
import { canAutoRetry, RowState } from "./flows/modelRowState";
import {
  PackageId,
  PACKAGES,
  packageAssets,
  planPackage,
  REFERENCE_BYTES_PER_SEC,
  storageShortfall,
  transferSeconds,
} from "./flows/packages";
import { formatBytes, formatCount, minutesLeft } from "./flows/format";

interface Props {
  onReady: () => void;
  /** Present when setup was reopened from Settings: lets the user leave without finishing. */
  onSkip?: () => void;
}

type Step = 1 | 2 | 3;
type IndexPhase = "waiting" | "building" | "ready" | "error";

/** No progress for this long shows the "restart downloads" escape hatch. */
const STALL_MS = 60_000;

export function SetupWizardScreen({ onReady, onSkip }: Props) {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const announce = useAnnounce();
  const { languageId, setLanguage } = useLanguage();
  const catalog = useCatalog();
  const lang = i18n.language;
  const [step, setStep] = useState<Step>(1);
  const [packageId, setPackageId] = useState<PackageId>("essential");
  const [backOpen, setBackOpen] = useState(false);
  const titleRef = useRef<View>(null);

  // Focus and announce the title on every step change (Prism F7).
  useEffect(() => {
    const node = titleRef.current && findNodeHandle(titleRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
    if (step > 1) announce(t("flows.onboarding.stepAnnounce", { step, title: t(`flows.onboarding.step${step}Title`) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const tier = TIERS.find((x) => x.id === PACKAGES.find((p) => p.id === packageId)!.tier)!;
  const assets = useMemo(() => packageAssets(tier, MODEL_CATALOG), [tier]);
  const present = useMemo(
    () => Object.fromEntries(Object.values(catalog.statuses).map((s) => [s.asset.id, s.present])),
    [catalog.statuses]
  );
  const allPresent = catalog.loaded && assets.every((a) => present[a.id]);

  const goBack = useCallback(() => {
    if (step === 3 && !allPresent) setBackOpen(true);
    else if (step > 1) setStep((s) => (s - 1) as Step);
    else if (onSkip) onSkip();
    else return false;
    return true;
  }, [step, allPresent, onSkip]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", goBack);
    return () => sub.remove();
  }, [goBack]);

  const startInstall = () => {
    impact(ImpactFeedbackStyle.Medium);
    setStep(3);
    for (const a of assets) if (!present[a.id]) catalog.download(a);
  };

  return (
    <>
      {step === 1 && <Welcome titleRef={titleRef} languageId={languageId} setLanguage={setLanguage} onNext={() => setStep(2)} onSkip={onSkip} />}
      {step === 2 && (
        <PackageStep
          titleRef={titleRef}
          selected={packageId}
          onSelect={setPackageId}
          present={present}
          freeBytes={catalog.freeBytes}
          deviceRamBytes={catalog.deviceRamBytes}
          loaded={catalog.loaded}
          lang={lang}
          onBack={() => setStep(1)}
          onInstall={startInstall}
        />
      )}
      {step === 3 && (
        <InstallStep
          titleRef={titleRef}
          assets={assets}
          catalog={catalog}
          allPresent={allPresent}
          lang={lang}
          onBack={() => setBackOpen(true)}
          onReady={onReady}
        />
      )}
      <Sheet
        visible={backOpen}
        onClose={() => setBackOpen(false)}
        title={t("flows.onboarding.backTitle")}
        description={t("flows.onboarding.backBody")}
        footer={
          <>
            <Button label={t("flows.onboarding.stay")} variant="secondary" fullWidth onPress={() => setBackOpen(false)} />
            <Button
              label={t("flows.onboarding.goBack")}
              variant="primary"
              fullWidth
              onPress={() => {
                setBackOpen(false);
                setStep(2);
              }}
            />
          </>
        }
      />
    </>
  );
}

function StepHeader({ titleRef, step, title, subtitle }: { titleRef: React.RefObject<View | null>; step: Step; title: string; subtitle?: string }) {
  const { t } = useTranslation();
  const tokens = useTokens();
  return (
    <View style={{ gap: tokens.space.xs }}>
      <Text variant="label" color="tertiary">
        {t("flows.onboarding.stepOf", { step, total: 3 })}
      </Text>
      <View ref={titleRef} accessible accessibilityRole="header" accessibilityLabel={title}>
        <Text variant="title1">{title}</Text>
      </View>
      {subtitle && (
        <Text variant="callout" color="secondary">
          {subtitle}
        </Text>
      )}
    </View>
  );
}

function Welcome({
  titleRef,
  languageId,
  setLanguage,
  onNext,
  onSkip,
}: {
  titleRef: React.RefObject<View | null>;
  languageId: LanguageId;
  setLanguage: (id: LanguageId) => Promise<void>;
  onNext: () => void;
  onSkip?: () => void;
}) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const announce = useAnnounce();
  const points: { icon: IconName; key: string }[] = [
    { icon: "wifi-off", key: "point1" },
    { icon: "shield", key: "point2" },
    { icon: "book", key: "point3" },
  ];
  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      footer={
        <>
          <Button label={t("flows.onboarding.start")} icon="arrow-right" iconPosition="end" fullWidth onPress={onNext} />
          {onSkip && <Button label={t("flows.onboarding.backToApp")} variant="ghost" fullWidth onPress={onSkip} />}
        </>
      }
    >
      <View style={{ alignItems: "center", gap: tokens.space.md, paddingTop: tokens.space.xl }}>
        <Image source={require("../../assets/boar.png")} style={{ width: 88, height: 88, borderRadius: tokens.radius.lg }} accessible={false} />
        <View ref={titleRef} accessible accessibilityRole="header" accessibilityLabel="BOAR">
          <Text variant="display" align="center">
            BOAR
          </Text>
        </View>
        <Text variant="title3" align="center" color="secondary">
          {t("flows.onboarding.tagline")}
        </Text>
      </View>
      <View style={{ gap: tokens.space.base }}>
        {points.map((p) => (
          <View key={p.key} style={{ flexDirection: "row", gap: tokens.space.md, alignItems: "flex-start" }}>
            <Icon name={p.icon} color={tokens.color.field.text} />
            <Text variant="body" style={{ flex: 1 }}>
              {t(`flows.onboarding.${p.key}`)}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ gap: tokens.space.sm }}>
        <Text variant="subhead" color="secondary">
          {t("flows.settings.language")}
        </Text>
        <SegmentedControl<LanguageId>
          label={t("flows.settings.language")}
          value={languageId}
          onChange={async (id) => {
            await setLanguage(id);
            announce(id === "pt" ? "Idioma: Português" : "Language: English");
          }}
          options={[
            { value: "en", label: "English" },
            { value: "pt", label: "Português" },
          ]}
        />
      </View>
    </Screen>
  );
}

function PackageStep({
  titleRef,
  selected,
  onSelect,
  present,
  freeBytes,
  deviceRamBytes,
  loaded,
  lang,
  onBack,
  onInstall,
}: {
  titleRef: React.RefObject<View | null>;
  selected: PackageId;
  onSelect: (id: PackageId) => void;
  present: Record<string, boolean>;
  freeBytes: number;
  deviceRamBytes: number;
  loaded: boolean;
  lang: string;
  onBack: () => void;
  onInstall: () => void;
}) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const plans = PACKAGES.map((p) => {
    const tier = TIERS.find((x) => x.id === p.tier)!;
    const plan = planPackage(packageAssets(tier, MODEL_CATALOG), present);
    const fit = plan.largestLlm ? fitFor(plan.largestLlm, deviceRamBytes) : undefined;
    const shortfall = storageShortfall(plan.downloadBytes, freeBytes);
    const seconds = transferSeconds(plan.downloadBytes, REFERENCE_BYTES_PER_SEC);
    return { ...p, plan, fit, shortfall, seconds };
  });
  const chosen = plans.find((p) => p.id === selected)!;

  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      footer={
        <>
          <Button
            label={chosen.plan.downloadBytes > 0 ? t("flows.onboarding.install", { size: formatBytes(chosen.plan.downloadBytes, lang) }) : t("flows.onboarding.continue")}
            fullWidth
            disabled={!loaded || chosen.shortfall > 0}
            onPress={onInstall}
          />
          <Button label={t("flows.onboarding.back")} variant="ghost" fullWidth onPress={onBack} />
        </>
      }
    >
      <StepHeader titleRef={titleRef} step={2} title={t("flows.onboarding.step2Title")} subtitle={t("flows.onboarding.step2Sub")} />
      <Text variant="footnote" color="secondary" numeric>
        {deviceRamBytes > 0 || freeBytes > 0
          ? t("flows.onboarding.device", {
              ram: deviceRamBytes > 0 ? formatBytes(deviceRamBytes, lang) : t("flows.onboarding.unknown"),
              free: freeBytes > 0 ? formatBytes(freeBytes, lang) : t("flows.onboarding.unknown"),
            })
          : t("flows.onboarding.deviceUnknown")}
      </Text>
      <View accessibilityRole="radiogroup" style={{ gap: tokens.space.md }}>
        {plans.map((p) => {
          const isSelected = p.id === selected;
          const facts = [
            p.plan.downloadBytes > 0
              ? t("flows.onboarding.download", { size: formatBytes(p.plan.downloadBytes, lang) })
              : t("flows.onboarding.alreadyDownloaded"),
            t("flows.onboarding.diskAfter", { size: formatBytes(p.plan.installedBytes, lang) }),
            p.seconds != null && p.plan.downloadBytes > 0
              ? t("flows.onboarding.time", { minutes: minutesLeft(p.seconds), speed: formatBytes(REFERENCE_BYTES_PER_SEC, lang) })
              : null,
          ].filter(Boolean) as string[];
          const warning =
            p.shortfall > 0
              ? t("flows.onboarding.noSpace", { size: formatBytes(p.shortfall, lang) })
              : p.fit === "thrashing"
                ? t("flows.row.fit.thrashing")
                : null;
          const name = t(`flows.onboarding.package.${p.id}.name`);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected, disabled: p.shortfall > 0 }}
              accessibilityLabel={[name, t(`flows.onboarding.package.${p.id}.body`), ...facts, warning].filter(Boolean).join(", ")}
              onPress={() => {
                impact(ImpactFeedbackStyle.Light);
                onSelect(p.id);
              }}
              style={{
                padding: tokens.space.base,
                gap: tokens.space.sm,
                borderRadius: tokens.radius.lg,
                borderWidth: isSelected ? 2 : tokens.size.hairline,
                borderColor: isSelected ? tokens.color.accent.solid : tokens.color.line.hairline,
                backgroundColor: tokens.color.bg.surface,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.sm, flexWrap: "wrap" }}>
                <Icon name={isSelected ? "check-circle" : "circle"} color={isSelected ? tokens.color.accent.text : tokens.color.text.tertiary} />
                <Text variant="headline">{name}</Text>
                {p.id === "encyclopedia" && p.shortfall === 0 && <Badge label={t("flows.onboarding.recommended")} tone="accent" />}
              </View>
              <Text variant="callout" color="secondary">
                {t(`flows.onboarding.package.${p.id}.body`)}
              </Text>
              {facts.map((f) => (
                <Text key={f} variant="footnote" numeric>
                  {f}
                </Text>
              ))}
              {warning && (
                <Text variant="footnote" color={p.shortfall > 0 ? "danger" : "warning"}>
                  {warning}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text variant="footnote" color="tertiary">
        {t("flows.onboarding.laterNote")}
      </Text>
    </Screen>
  );
}

function statusLine(state: RowState, model: CatalogModel, t: ReturnType<typeof useTranslation>["t"], lang: string): string {
  switch (state.kind) {
    case "not-installed":
      return t("flows.onboarding.queued");
    case "downloading":
      return t("flows.onboarding.downloadingLine", {
        pct: Math.round(state.progress * 100),
        done: formatBytes(model.sizeBytes * state.progress, lang),
        total: formatBytes(model.sizeBytes, lang),
      });
    case "verifying":
      return t("flows.row.verifying");
    case "failed":
      return t(`flows.row.error.${state.errorKind}`);
    case "loading":
      return t("flows.row.loading");
    default:
      return t("flows.onboarding.ready");
  }
}

function InstallStep({
  titleRef,
  assets,
  catalog,
  allPresent,
  lang,
  onBack,
  onReady,
}: {
  titleRef: React.RefObject<View | null>;
  assets: CatalogModel[];
  catalog: ReturnType<typeof useCatalog>;
  allPresent: boolean;
  lang: string;
  onBack: () => void;
  onReady: () => void;
}) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const announce = useAnnounce();
  const [indexPhase, setIndexPhase] = useState<IndexPhase>("waiting");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [seed, setSeed] = useState<SeedProgress | null>(null);
  const seedStart = useRef<{ at: number; done: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  const states = assets.map((a) => ({ asset: a, state: catalog.view(a).state }));
  const downloading = states.some((s) => s.state.kind === "downloading" || s.state.kind === "verifying");
  const failed = states.filter((s) => s.state.kind === "failed");

  // Aggregate progress, and when it last moved, for the stall hint.
  const totalBytes = assets.reduce((sum, a) => sum + a.sizeBytes, 0);
  const doneBytes = states.reduce((sum, { asset, state }) => {
    if (state.kind === "downloading") return sum + asset.sizeBytes * state.progress;
    if (state.kind === "installed" || state.kind === "in-use") return sum + asset.sizeBytes;
    return sum;
  }, 0);
  const lastMove = useRef({ bytes: doneBytes, at: Date.now() });
  if (doneBytes !== lastMove.current.bytes) lastMove.current = { bytes: doneBytes, at: Date.now() };
  useEffect(() => {
    if (!downloading) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [downloading]);
  const stalled = downloading && now - lastMove.current.at > STALL_MS;

  // Announce every quarter of the download, never per tick (Prism F4).
  const quarter = totalBytes > 0 ? Math.floor((doneBytes / totalBytes) * 4) : 0;
  const lastQuarter = useRef(quarter);
  useEffect(() => {
    if (quarter > lastQuarter.current && quarter < 4) announce(t("flows.onboarding.percentAnnounce", { pct: quarter * 25 }));
    lastQuarter.current = quarter;
  }, [quarter, announce, t]);

  // Coming back to the app: retry only failures that retrying can fix.
  const retryable = useRef<CatalogModel[]>([]);
  retryable.current = states.filter((s) => canAutoRetry(s.state)).map((s) => s.asset);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") for (const a of retryable.current) catalog.download(a);
    });
    return () => sub.remove();
    // catalog.download is stable (useCallback on refresh).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      onSeedProgress((p) => {
        seedStart.current ??= { at: Date.now(), done: p.done };
        setSeed(p);
      }),
    []
  );

  const buildIndex = useCallback(async () => {
    setIndexPhase("building");
    setIndexError(null);
    try {
      const emb = MODEL_CATALOG.find((m) => m.kind === "embedding" && m.required)!;
      await embeddingEngine.load(emb.filename);
      await seedKnowledgeBaseIfEmpty();
      setIndexPhase("ready");
      notification(NotificationFeedbackType.Success);
      announce(t("flows.onboarding.doneAnnounce"));
    } catch (e: any) {
      setIndexError(e?.message ?? String(e));
      setIndexPhase("error");
      announce(t("flows.onboarding.indexFailed"), { assertive: true });
    }
  }, [announce, t]);

  useEffect(() => {
    if (allPresent && indexPhase === "waiting") buildIndex();
  }, [allPresent, indexPhase, buildIndex]);

  const seedEta = (() => {
    const s = seedStart.current;
    if (!seed || !s) return undefined;
    const elapsed = (Date.now() - s.at) / 1000;
    const indexed = seed.done - s.done;
    if (elapsed < 3 || indexed < 5) return undefined;
    return ((seed.total - seed.done) * elapsed) / indexed;
  })();

  const ready = indexPhase === "ready";
  return (
    <Screen
      edges={["top", "bottom", "left", "right"]}
      footer={
        ready ? (
          <Button label={t("flows.onboarding.open")} fullWidth onPress={onReady} />
        ) : (
          <Button label={t("flows.onboarding.back")} variant="ghost" fullWidth onPress={onBack} disabled={indexPhase === "building"} />
        )
      }
    >
      <StepHeader
        titleRef={titleRef}
        step={3}
        title={ready ? t("flows.onboarding.doneTitle") : t("flows.onboarding.step3Title")}
        subtitle={ready ? t("flows.onboarding.doneBody") : t("flows.onboarding.step3Sub")}
      />

      {!allPresent && (
        <View style={{ gap: tokens.space.xs }}>
          <Progress
            label={t("flows.onboarding.totalLabel")}
            value={totalBytes > 0 ? doneBytes / totalBytes : 0}
            valueText={t("flows.onboarding.totalValue", { done: formatBytes(doneBytes, lang), total: formatBytes(totalBytes, lang) })}
          />
          <Text variant="footnote" color="secondary" numeric>
            {t("flows.onboarding.totalValue", { done: formatBytes(doneBytes, lang), total: formatBytes(totalBytes, lang) })}
          </Text>
        </View>
      )}

      <View style={{ gap: tokens.space.base }}>
        {states.map(({ asset, state }) => (
          <View key={asset.id} style={{ gap: tokens.space.xs }}>
            <View style={{ flexDirection: "row", gap: tokens.space.sm, alignItems: "center" }}>
              <PhaseIcon state={state} />
              <Text variant="subhead" style={{ flex: 1 }}>
                {t(`flows.row.kind.${asset.kind}`)} · {asset.label}
              </Text>
            </View>
            <Text variant="footnote" color={state.kind === "failed" ? "danger" : "secondary"} numeric>
              {statusLine(state, asset, t, lang)}
            </Text>
            {state.kind === "downloading" && (
              <Progress
                label={asset.label}
                value={state.progress}
                valueText={`${asset.label}, ${statusLine(state, asset, t, lang)}`}
              />
            )}
          </View>
        ))}
        <View style={{ gap: tokens.space.xs }}>
          <View style={{ flexDirection: "row", gap: tokens.space.sm, alignItems: "center" }}>
            <Icon
              name={ready ? "check-circle" : indexPhase === "error" ? "alert-octagon" : "circle"}
              color={ready ? tokens.color.status.success.solid : indexPhase === "error" ? tokens.color.status.danger.solid : tokens.color.text.tertiary}
            />
            <Text variant="subhead" style={{ flex: 1 }}>
              {t("flows.onboarding.indexRow")}
            </Text>
          </View>
          <Text variant="footnote" color="secondary" numeric>
            {indexPhase === "waiting"
              ? t("flows.onboarding.waitingDownloads")
              : indexPhase === "building" && seed
                ? t("flows.onboarding.indexCounter", { done: formatCount(seed.done, lang), total: formatCount(seed.total, lang) }) +
                  (seedEta != null ? ` · ${t("flows.onboarding.minutesLeft", { count: minutesLeft(seedEta) })}` : "")
                : indexPhase === "building"
                  ? t("flows.onboarding.indexStarting")
                  : indexPhase === "ready"
                    ? t("flows.onboarding.ready")
                    : t("flows.onboarding.indexFailed")}
          </Text>
          {indexPhase === "building" && seed && (
            <Progress label={t("flows.onboarding.indexRow")} value={seed.done / seed.total} valueText={t("flows.onboarding.indexCounter", { done: seed.done, total: seed.total })} tone="field" />
          )}
        </View>
      </View>

      {failed.length > 0 && (
        <EmptyState
          tone="error"
          title={t("flows.onboarding.downloadFailed")}
          body={failed.map((f) => `${f.asset.label}: ${f.state.kind === "failed" ? f.state.message : ""}`).join("\n")}
          actionLabel={t("flows.row.retry")}
          onAction={() => failed.forEach((f) => catalog.download(f.asset))}
        />
      )}

      {indexPhase === "error" && (
        <EmptyState tone="error" title={t("flows.onboarding.indexFailed")} body={indexError ?? undefined} actionLabel={t("flows.row.retry")} onAction={buildIndex} />
      )}

      {stalled && (
        <Button
          variant="secondary"
          icon="refresh-cw"
          label={t("flows.onboarding.restart")}
          onPress={() => {
            for (const { asset, state } of states) if (state.kind !== "installed" && state.kind !== "in-use") restartDownload(asset).finally(() => catalog.refresh());
          }}
        />
      )}

      {downloading && (
        <Text variant="footnote" color="secondary">
          {t("flows.onboarding.keepOpen")}
        </Text>
      )}
    </Screen>
  );
}

function PhaseIcon({ state }: { state: RowState }) {
  const tokens = useTokens();
  if (state.kind === "installed" || state.kind === "in-use") return <Icon name="check-circle" color={tokens.color.status.success.solid} />;
  if (state.kind === "failed") return <Icon name="alert-octagon" color={tokens.color.status.danger.solid} />;
  if (state.kind === "downloading" || state.kind === "verifying") return <Icon name="download" color={tokens.color.accent.text} />;
  return <Icon name="circle" color={tokens.color.text.tertiary} />;
}
