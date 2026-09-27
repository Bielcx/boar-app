/**
 * First-run setup in three steps: welcome → capacity package → install and
 * index. Every number shown is measured on the device or computed from the
 * manifest (flows-spec §4.1); nothing is typed in by hand.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, AppState, BackHandler, findNodeHandle, Linking, Pressable, Text as RNText, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, EmptyState, Icon, IconName, ListRow, Mascot, MetaLine, OptionCard, Progress, Screen, Section, Sheet, Stat, Stepper, Switch, Text, TextAction, useAnnounce } from "./components";
import type { TextColor } from "./components/Text";
import { useTokens } from "./theme";
import { impact, ImpactFeedbackStyle, notification, NotificationFeedbackType } from "../services/haptics";
import { useLanguage } from "../i18n/LanguageContext";
import { getSetupProgress, LanguageId, setActiveModelId, setSetupProgress } from "../models/settings";
import { CatalogModel, MODEL_CATALOG, TIERS } from "../models/manifest";
import { findAsset } from "../models/assetRegistry";
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
import { failureLines, formatBytes, formatCount, formatRam, minutesAbout, minutesLeft } from "./flows/format";
import { answerModelChoices, AnswerTier, recommendPackage } from "./flows/packages";
import { COMPACT_ONLY_MAX_RAM_BYTES, pickDefaultAnswerModel } from "../routing/defaultModel";
import { placesInstall, poiRegions } from "./flows/adapters";
import { canDownload } from "./flows/useCatalog";
import { CitySearch } from "./flows/CitySearch";
import { citySummary, deviceTimeZone, PoiRegion, suggestRegion } from "./flows/poi";
import { locateForUser } from "../services/location";
import { networkAllowed } from "../config/variant";
import { ImportList } from "./flows/ImportList";
import { RadioRow } from "./flows/RadioRow";
import { InstallCategory, installCategories } from "./flows/installGroups";
import { likelyTarget } from "./flows/fileImport";

interface Props {
  onReady: () => void;
  /** Present when setup was reopened from Settings: lets the user leave without finishing. */
  onSkip?: () => void;
}

type Step = 1 | 2 | 3;
type IndexPhase = "waiting" | "building" | "ready" | "error";

/** The mockup's setup rhythm (FIDELITY): 14 pt between blocks, content right under the stepper. */
function setupRhythm(t: ReturnType<typeof useTokens>) {
  return { gap: t.space.md + t.space.xxs, paddingTop: t.space.xs };
}

/** Narrowest screen (pt) where the language cards keep their EN/PT monogram (393 yes, 360 no). */
const MONOGRAM_MIN_WIDTH = 380;

const ANSWER_FIT_TONE = { resident: "success", streaming: "warning", thrashing: "warning", insufficient: "danger" } as const;

/** Above this OS font scale the two language cards stack instead of sitting side by side. */
const LARGE_TEXT = 1.15;
const LANGUAGES: { id: LanguageId; name: string }[] = [
  { id: "en", name: "English" },
  { id: "pt", name: "Português" },
];

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
  const [travel, setTravel] = useState<PoiRegion | null>(null);
  const [trip, setTrip] = useState<{ label: string; assets: CatalogModel[] } | null>(null);
  const choices = useMemo(() => answerModelChoices(MODEL_CATALOG), []);
  const [answerTier, setAnswerTier] = useState<AnswerTier>("default");
  // Set once the user picked (or progress was restored): automatic recommendations never override it.
  const [packageChosen, setPackageChosen] = useState(false);
  const [answerChosen, setAnswerChosen] = useState(false);
  const answerModel = (answerTier === "compact" && choices.compact) || choices.default;
  const [restored, setRestored] = useState(false);

  // Resume where setup was: a font-size change recreates the Android Activity,
  // and the process can be killed during a long download.
  useEffect(() => {
    getSetupProgress().then((p) => {
      if (p) {
        if (PACKAGES.some((x) => x.id === p.packageId)) setPackageId(p.packageId as PackageId);
        if (p.answerTier) setAnswerTier(p.answerTier);
        // Only a real pick is kept; an automatic recommendation is recomputed (Prism S2-3).
        setPackageChosen(!!p.packageChosen);
        setAnswerChosen(!!p.answerChosen);
        const region = p.travelRegionId ? poiRegions().find((r) => r.id === p.travelRegionId) : undefined;
        if (region) setTravel(region);
        // The trip's items back from their ids; one that no longer exists drops the trip rather than half of it.
        const tripAssets = p.trip?.assetIds.map((id) => findAsset(id));
        if (p.trip && tripAssets?.every(Boolean)) setTrip({ label: p.trip.label, assets: tripAssets as CatalogModel[] });
        setStep(p.step);
      }
      setRestored(true);
    });
  }, []);
  useEffect(() => {
    if (restored)
      setSetupProgress({
        step,
        packageId,
        travelRegionId: travel?.id,
        trip: trip ? { label: trip.label, assetIds: trip.assets.map((a) => a.id) } : undefined,
        answerTier,
        packageChosen,
        answerChosen,
      });
  }, [restored, step, packageId, travel, trip, answerTier, packageChosen, answerChosen]);
  const titleRef = useRef<RNText>(null);

  // Focus and announce the title on every step change (Prism F7).
  useEffect(() => {
    const node = titleRef.current && findNodeHandle(titleRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
    // Same count the Stepper speaks: step 2 is stage 2 (Choose), step 3 starts at stage 3 (Install).
    if (step > 1) announce(t("flows.onboarding.stageOf", { n: step, total: STAGES.length, name: t(`flows.onboarding.stage.${STAGES[step - 1]}`) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const tier = TIERS.find((x) => x.id === PACKAGES.find((p) => p.id === packageId)!.tier)!;
  const assets = useMemo(() => {
    const all = [...packageAssets(tier, MODEL_CATALOG, answerModel), ...(travel ? placesInstall(travel) : []), ...(trip?.assets ?? [])];
    // The gazetteer can come from both the region and the trip: install it once.
    return all.filter((a, i) => all.findIndex((b) => b.id === a.id) === i);
  }, [tier, travel, trip, answerModel]);
  const present = useMemo(
    () => Object.fromEntries(Object.values(catalog.statuses).map((s) => [s.asset.id, s.present])),
    [catalog.statuses]
  );
  const allPresent = catalog.loaded && assets.every((a) => present[a.id]);

  // Leaving a setup reopened from Settings forgets its progress, or the next launch would resume it.
  const skip = useMemo(
    () =>
      onSkip &&
      (() => {
        setSetupProgress(null);
        onSkip();
      }),
    [onSkip]
  );
  const goBack = useCallback(() => {
    if (step === 3 && !allPresent) setBackOpen(true);
    else if (step > 1) setStep((s) => (s - 1) as Step);
    else if (skip) skip();
    else return false;
    return true;
  }, [step, allPresent, skip]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", goBack);
    return () => sub.remove();
  }, [goBack]);

  // Restored into step 3 (process killed mid-download): start what is still missing, once.
  const resumed = useRef(false);
  useEffect(() => {
    if (!restored || resumed.current || step !== 3 || !catalog.loaded || !networkAllowed()) return;
    resumed.current = true;
    for (const a of assets) {
      const kind = catalog.view(a).state.kind;
      if (!present[a.id] && canDownload(a) && kind !== "downloading" && kind !== "verifying") catalog.download(a);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, step, catalog.loaded]);

  const startInstall = () => {
    resumed.current = true;
    impact(ImpactFeedbackStyle.Medium);
    setStep(3);
    // The offline build has no network: step 3 imports files instead.
    for (const a of assets) if (!present[a.id] && canDownload(a)) catalog.download(a);
  };

  return (
    <>
      {step === 1 && (
        <Welcome
          titleRef={titleRef}
          languageId={languageId}
          setLanguage={setLanguage}
          deviceRamBytes={catalog.deviceRamBytes}
          freeBytes={catalog.freeBytes}
          lang={lang}
          onNext={() => setStep(2)}
          onSkip={skip}
        />
      )}
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
          travel={travel}
          onTravel={setTravel}
          trip={trip}
          onTrip={setTrip}
          catalog={catalog}
          choices={choices}
          answerTier={answerTier}
          onAnswerTier={setAnswerTier}
          packageChosen={packageChosen}
          answerChosen={answerChosen}
          onUserPackage={(id) => {
            setPackageChosen(true);
            setPackageId(id);
          }}
          onUserAnswer={(tierId) => {
            setAnswerChosen(true);
            setAnswerTier(tierId);
          }}
          restored={restored}
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
          onChoosePackage={() => setStep(2)}
          answerModel={answerModel}
          placesLabel={trip?.label ?? (travel ? (lang.startsWith("pt") ? travel.name.pt : travel.name.en) : undefined)}
          onReady={async () => {
            // The chosen answer model (default or compact) writes the answers from now on.
            if (answerModel) await setActiveModelId("llm", answerModel.id);
            setSetupProgress(null);
            onReady();
          }}
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

/** The four stages the user sees: step 3 covers both install and index. */
const STAGES = ["start", "choose", "install", "index"] as const;

/** The labelled stepper (the mockup's HARDWARE → MODEL TIER → INSTALL → INDEXING). */
function SetupStepper({ stage }: { stage: number }) {
  const { t } = useTranslation();
  const names = STAGES.map((s) => t(`flows.onboarding.stage.${s}`));
  return (
    <Stepper
      steps={names}
      current={stage}
      accessibilityLabel={t("flows.onboarding.stageOf", { n: stage + 1, total: STAGES.length, name: names[stage] })}
    />
  );
}

function StepHeader({ titleRef, stage, title, subtitle }: { titleRef: React.RefObject<RNText | null>; stage: number; title: string; subtitle?: string }) {
  const tokens = useTokens();
  return (
    // 18 pt from the stepper's labels to the title, as measured on the mockup (FIDELITY).
    <View style={{ gap: tokens.space.base + tokens.space.xxs }}>
      <SetupStepper stage={stage} />
      <View style={{ gap: tokens.space.xs }}>
        {/* 26 pt like the mockup's step titles (FIDELITY). */}
        <Text ref={titleRef} variant="title1" header>
          {title}
        </Text>
        {subtitle && (
          <Text variant="footnote" color="secondary">
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}

function Welcome({
  titleRef,
  languageId,
  setLanguage,
  deviceRamBytes,
  freeBytes,
  lang,
  onNext,
  onSkip,
}: {
  titleRef: React.RefObject<RNText | null>;
  languageId: LanguageId;
  setLanguage: (id: LanguageId) => Promise<void>;
  deviceRamBytes: number;
  freeBytes: number;
  lang: string;
  onNext: () => void;
  onSkip?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const announce = useAnnounce();
  const { fontScale } = useWindowDimensions();
  const { width } = useWindowDimensions();
  // The EN/PT monogram fits two cards side by side on a 393 pt screen, not on a 360 dp one (Iris).
  const monogram = width >= MONOGRAM_MIN_WIDTH && fontScale <= LARGE_TEXT;
  // Measured on this phone; a value the OS would not give is left out, never guessed.
  const phone = [
    { key: "phoneMemory", value: deviceRamBytes > 0 ? formatRam(deviceRamBytes, lang) : null },
    { key: "phoneFree", value: freeBytes > 0 ? formatBytes(freeBytes, lang) : null },
    { key: "phoneEngine", value: t("flows.onboarding.phoneEngineValue") },
  ].filter((r): r is { key: string; value: string } => !!r.value);
  return (
    <Screen
      contentStyle={setupRhythm(tokens)}
      ambient
      edges={["top", "bottom", "left", "right"]}
      footer={
        <>
          <Button size="lg" label={t("flows.onboarding.start")} icon="arrow-right" iconPosition="end" fullWidth onPress={onNext} />
          {onSkip && <Button label={t("flows.onboarding.backToApp")} variant="ghost" fullWidth onPress={onSkip} />}
        </>
      }
    >
      <SetupStepper stage={0} />
      {/* The mockup's brand row: disc 48, gap 10, wordmark 28 (title1 26), tagline 12 in a2, 3 pt apart. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.md - tokens.space.xxs }}>
        <Mascot size="brand" />
        <View style={{ flex: 1, gap: tokens.space.xxs }}>
          {/* The identity's wordmark is lowercase (chat header, splash). */}
          <Text ref={titleRef} variant="title1" header>
            boar
          </Text>
          <Text variant="caption" color="field">
            {t("flows.onboarding.brandSub")}
          </Text>
        </View>
      </View>
      {/* One overline and one paragraph of 13.5, like the mockup (Iris, Prism F1-3). */}
      <Card padding="compact" style={{ gap: tokens.space.xs + tokens.space.xxs }}>
        <Text variant="label" color="field">
          {t("flows.onboarding.introLabel")}
        </Text>
        <Text variant="footnote">{t("flows.onboarding.introBody")}</Text>
      </Card>
      <View style={{ gap: tokens.space.sm }}>
        <Text variant="label" color="secondary">
          {t("flows.settings.language")}
        </Text>
        {/* Side by side like the mockup; stacked when large text would break "Português". */}
        <View accessibilityRole="radiogroup" style={{ flexDirection: fontScale > LARGE_TEXT ? "column" : "row", gap: tokens.space.sm }}>
          {LANGUAGES.map((l) => {
            const selected = languageId === l.id;
            return (
              <View key={l.id} style={fontScale > LARGE_TEXT ? undefined : { flex: 1 }}>
                <OptionCard
                  title={l.name}
                  indicator="check"
                  selected={selected}
                  leading={
                    monogram ? (
                      <View
                        style={{
                          width: tokens.size.controlSm,
                          height: tokens.size.controlSm,
                          borderRadius: tokens.radius.full,
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: selected ? tokens.color.accent.solid : tokens.color.bg.raised,
                        }}
                        importantForAccessibility="no-hide-descendants"
                        accessibilityElementsHidden
                      >
                        <Text variant="caption" weight="semibold" color={selected ? "onAccent" : "primary"}>
                          {l.id.toUpperCase()}
                        </Text>
                      </View>
                    ) : undefined
                  }
                  onPress={async () => {
                    await setLanguage(l.id);
                    announce(i18n.getFixedT(l.id)("flows.onboarding.languageAnnounce"));
                  }}
                />
              </View>
            );
          })}
        </View>
      </View>
      {/* The mockup's hardware card, with measured values only: no "Verified" column (Prism F1-5/F1-6). */}
      <Card style={{ paddingTop: tokens.space.md, paddingHorizontal: tokens.space.md + tokens.space.xxs, paddingBottom: tokens.space.xs + tokens.space.xxs }}>
        <Text variant="label" color="secondary">
          {t("flows.onboarding.phoneLabel")}
        </Text>
        {phone.map((r, i) => (
          <View
            key={r.key}
            accessible
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: tokens.space.sm,
              paddingVertical: tokens.space.xs + tokens.space.xxs,
              borderTopWidth: i > 0 ? tokens.size.hairline : 0,
              borderTopColor: tokens.color.line.row,
            }}
          >
            <Text variant="footnote" color="secondary">
              {t(`flows.onboarding.${r.key}`)}
            </Text>
            <Text variant="caption" numeric>
              {r.value}
            </Text>
          </View>
        ))}
      </Card>
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
  travel,
  onTravel,
  trip,
  onTrip,
  catalog,
  choices,
  answerTier,
  onAnswerTier,
  packageChosen,
  answerChosen,
  onUserPackage,
  onUserAnswer,
  restored,
  onBack,
  onInstall,
}: {
  titleRef: React.RefObject<RNText | null>;
  selected: PackageId;
  onSelect: (id: PackageId) => void;
  present: Record<string, boolean>;
  freeBytes: number;
  deviceRamBytes: number;
  loaded: boolean;
  lang: string;
  travel: PoiRegion | null;
  onTravel: (region: PoiRegion | null) => void;
  trip: { label: string; assets: CatalogModel[] } | null;
  onTrip: (trip: { label: string; assets: CatalogModel[] } | null) => void;
  catalog: ReturnType<typeof useCatalog>;
  choices: Partial<Record<AnswerTier, CatalogModel>>;
  answerTier: AnswerTier;
  onAnswerTier: (tier: AnswerTier) => void;
  packageChosen: boolean;
  answerChosen: boolean;
  onUserPackage: (id: PackageId) => void;
  onUserAnswer: (tier: AnswerTier) => void;
  restored: boolean;
  onBack: () => void;
  onInstall: () => void;
}) {
  // Tusk's rule (src/routing/defaultModel.ts): standard model unless the phone is low on RAM or it won't run well.
  const pick = pickDefaultAnswerModel(
    (["default", "compact"] as const)
      .map((tierId) => choices[tierId])
      .filter((m): m is CatalogModel => !!m)
      .map((m) => ({ id: m.id, answerTier: m.answerTier, fit: fitFor(m)?.verdict })),
    deviceRamBytes
  );
  const compactSuggested = !!choices.compact && pick?.id === choices.compact.id;
  const recommendedTier: AnswerTier | undefined = pick ? (pick.id === choices.compact?.id ? "compact" : "default") : undefined;
  // Recommended = pre-selected: follow the routing rule until the user picks.
  useEffect(() => {
    if (restored && loaded && !answerChosen && recommendedTier) onAnswerTier(recommendedTier);
  }, [restored, loaded, answerChosen, recommendedTier, onAnswerTier]);
  const answerModel = (answerTier === "compact" && choices.compact) || choices.default;
  // Computed from Tusk's estimate for this phone: the honest stand-in for the mockup's "Runs Great / RAM".
  const answerFit = answerModel ? fitFor(answerModel) : undefined;
  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const { t } = useTranslation();
  const tokens = useTokens();
  const offline = !networkAllowed();
  const plans = PACKAGES.map((p) => {
    const tier = TIERS.find((x) => x.id === p.tier)!;
    const all = [...packageAssets(tier, MODEL_CATALOG, answerModel), ...(travel ? placesInstall(travel) : []), ...(trip?.assets ?? [])];
    const plan = planPackage(all.filter((a, i) => all.findIndex((b) => b.id === a.id) === i), present);
    const fit = plan.largestLlm ? fitFor(plan.largestLlm)?.verdict : undefined;
    const shortfall = storageShortfall(plan.downloadBytes, freeBytes);
    const seconds = transferSeconds(plan.downloadBytes, REFERENCE_BYTES_PER_SEC);
    return { ...p, plan, fit, shortfall, seconds };
  });
  const chosen = plans.find((p) => p.id === selected)!;
  const recommended = recommendPackage(plans);
  // Recommended = pre-selected, once free space is known, until the user picks.
  useEffect(() => {
    if (restored && loaded && !packageChosen && selected !== recommended) onSelect(recommended);
  }, [restored, loaded, packageChosen, recommended, selected, onSelect]);

  return (
    <Screen
      contentStyle={setupRhythm(tokens)}
      edges={["top", "bottom", "left", "right"]}
      footer={
        <>
          <Button
            size="lg"
            // The mockup's CTA carries an arrow (Prism S2F-2).
            icon="arrow-right"
            iconPosition="end"
            label={
              chosen.plan.downloadBytes > 0 && !offline
                ? t("flows.onboarding.install", { size: formatBytes(chosen.plan.downloadBytes, lang) })
                : t("flows.onboarding.continue")
            }
            fullWidth
            disabled={!loaded || chosen.shortfall > 0}
            accessibilityHint={chosen.shortfall > 0 ? t("flows.onboarding.noSpace", { size: formatBytes(chosen.shortfall, lang) }) : undefined}
            onPress={onInstall}
          />
          {chosen.shortfall > 0 && (
            <Text variant="footnote" color="danger" align="center">
              {t("flows.onboarding.noSpace", { size: formatBytes(chosen.shortfall, lang) })}
            </Text>
          )}
          <BackLink label={t("flows.onboarding.back")} onPress={onBack} />
        </>
      }
    >
      <StepHeader titleRef={titleRef} stage={1} title={t("flows.onboarding.step2Title")} subtitle={t(offline ? "flows.onboarding.step2SubOffline" : "flows.onboarding.step2Sub")} />
      {/* The mockup's model card on top: what will answer, with a computed fact in place of "Runs Great" (FIDELITY). */}
      {answerModel && (
        <Card
          padding="compact"
          style={{ gap: tokens.space.sm }}
          // Standard/Compact is chosen by tapping the card, not an extra row (the mockup has none).
          onPress={choices.compact && choices.default ? () => setModelSheetOpen(true) : undefined}
          accessibilityLabel={[t(`flows.onboarding.answerTier.${answerTier}`), answerModel.label, formatBytes(answerModel.sizeBytes, lang)].join(", ")}
          accessibilityHint={choices.compact && choices.default ? t("flows.onboarding.chooseAnswerHint") : undefined}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.xs + tokens.space.xxs }}>
            <Text variant="label" color="field">
              {t("flows.onboarding.llmLabel")}
            </Text>
            {answerTier === recommendedTier && <Badge label={t("flows.onboarding.suggested")} tone="accent" emphasis="solid" />}
            <Text variant="caption" color="secondary" numeric style={{ marginLeft: "auto" }}>
              {formatBytes(answerModel.sizeBytes, lang)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.sm }}>
            <Text variant="headline" style={{ flex: 1 }}>
              {answerModel.label}
            </Text>
            {choices.compact && choices.default && <Icon name="chevron-right" size="sm" color={tokens.color.text.secondary} />}
          </View>
          {answerFit && (
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: tokens.space.xs + tokens.space.xxs }}>
              <Badge label={t(`flows.row.fitShort.${answerFit.verdict}`)} tone={ANSWER_FIT_TONE[answerFit.verdict]} dot caps={false} />
              <Text variant="caption" color="secondary" numeric>
                {t("flows.onboarding.workingMemory", { size: formatRam(answerFit.anonBytes + (answerFit.expertFraction === 0 ? answerFit.fileBytes : 0), lang) })}
              </Text>
            </View>
          )}
        </Card>
      )}
      {choices.compact && choices.default && (
        <Sheet
          visible={modelSheetOpen}
          onClose={() => setModelSheetOpen(false)}
          title={t("flows.onboarding.chooseAnswerTitle")}
          description={
            compactSuggested
              ? pick?.reason === "compact-low-ram"
                ? t("flows.onboarding.compactLowRam", { ram: formatRam(COMPACT_ONLY_MAX_RAM_BYTES, lang) })
                : t("flows.onboarding.compactWhy")
              : undefined
          }
        >
          <View accessibilityRole="radiogroup" style={{ gap: tokens.space.sm }}>
            {(["default", "compact"] as const).map((tierId) => {
              const m = choices[tierId]!;
              return (
                <OptionCard
                  key={tierId}
                  title={t(`flows.onboarding.answerTier.${tierId}`)}
                  selected={answerTier === tierId}
                  onPress={() => {
                    onUserAnswer(tierId);
                    setModelSheetOpen(false);
                  }}
                  badge={tierId === recommendedTier ? <Badge label={t("flows.onboarding.suggested")} tone="accent" emphasis="solid" /> : undefined}
                  trailing={formatBytes(m.sizeBytes, lang)}
                  meta={[m.label]}
                />
              );
            })}
          </View>
        </Sheet>
      )}
      <View accessibilityRole="radiogroup" style={{ gap: tokens.space.sm }}>
        {plans.map((p) => {
          const warning =
            p.shortfall > 0
              ? t("flows.onboarding.noSpace", { size: formatBytes(p.shortfall, lang) })
              : p.fit === "insufficient" || p.fit === "thrashing" || p.fit === "streaming"
                ? t(`flows.row.fit.${p.fit}`)
                : null;
          return (
            <OptionCard
              key={p.id}
              title={t(`flows.onboarding.package.${p.id}.name`)}
              selected={p.id === selected}
              onPress={() => onUserPackage(p.id)}
              badge={p.id === recommended ? <Badge label={t("flows.onboarding.recommended")} tone="accent" emphasis="solid" /> : undefined}
              // The one number that decides: what this choice downloads (or imports) now.
              trailing={p.plan.downloadBytes > 0 ? formatBytes(p.plan.downloadBytes, lang) : undefined}
              description={t(`flows.onboarding.package.${p.id}.body`)}
              meta={[
                p.plan.downloadBytes === 0 && t("flows.onboarding.alreadyDownloaded"),
                // Only when it differs from the figure on the right (import, part already downloaded).
                formatBytes(p.plan.installedBytes, lang) !== formatBytes(p.plan.downloadBytes, lang) &&
                  t("flows.onboarding.meta.onDisk", { size: formatBytes(p.plan.installedBytes, lang) }),
                !offline &&
                  p.seconds != null &&
                  p.plan.downloadBytes > 0 &&
                  t("flows.onboarding.meta.time", { minutes: minutesAbout(p.seconds), speed: formatBytes(REFERENCE_BYTES_PER_SEC, lang) }),
              ]}
            >
              {warning && (
                <Text variant="footnote" color={p.shortfall > 0 || p.fit === "insufficient" ? "danger" : "warning"}>
                  {warning}
                </Text>
              )}
            </OptionCard>
          );
        })}
      </View>
      <TravelCard selected={travel} onChange={onTravel} lang={lang} trip={trip} onTrip={onTrip} catalog={catalog} />
    </Screen>
  );
}

/** Optional offline places for the user's region (P1). Hidden when the build has no region packs. */
function TravelCard({
  selected,
  onChange,
  lang,
  trip,
  onTrip,
  catalog,
}: {
  selected: PoiRegion | null;
  onChange: (r: PoiRegion | null) => void;
  lang: string;
  trip: { label: string; assets: CatalogModel[] } | null;
  onTrip: (trip: { label: string; assets: CatalogModel[] } | null) => void;
  catalog: ReturnType<typeof useCatalog>;
}) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const regions = useMemo(() => poiRegions(), []);
  const [point, setPoint] = useState<{ lat: number; lon: number } | undefined>();
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manual, setManual] = useState<PoiRegion | null>(null);
  const [tripOpen, setTripOpen] = useState(false);
  const tripRef = useRef<View>(null);
  const announce = useAnnounce();
  const explainAnswer = useRef<((ok: boolean) => void) | null>(null);
  const locateRef = useRef<View>(null);
  const otherRef = useRef<View>(null);

  if (regions.length === 0) return null;
  const auto = suggestRegion(regions, { timeZone: deviceTimeZone(), point });
  const suggestion: { region: PoiRegion; reason: "location" | "timezone" | "manual" } | null = manual
    ? { region: manual, reason: "manual" }
    : auto;

  const explain = () =>
    new Promise<boolean>((resolve) => {
      explainAnswer.current = resolve;
      setExplainOpen(true);
    });
  const answerExplain = (ok: boolean) => {
    setExplainOpen(false);
    explainAnswer.current?.(ok);
    explainAnswer.current = null;
  };

  const useLocation = async () => {
    setLocating(true);
    setLocationNote(null);
    const result = await locateForUser(explain);
    setLocating(false);
    if (result.status === "ok") {
      setPoint({ lat: result.lat, lon: result.lon });
      setManual(null);
      setDeclined(false);
      // A different region now wins: don't keep including the old one silently.
      if (selected) onChange(null);
    } else {
      const note = t(result.status === "declined" ? "flows.places.locationDeclined" : "flows.places.locationUnavailable");
      setLocationNote(note);
      setDeclined(result.status === "declined");
      announce(note);
    }
  };

  const region = suggestion?.region;
  const name = region ? (lang.startsWith("pt") ? region.name.pt : region.name.en) : "";
  const cities = region ? citySummary(region) : null;

  return (
    <Section title={t("flows.places.travelTitle")} footer={t("flows.places.footer")}>
      {region && cities ? (
        <>
          {/* In the rhythm of the mockup's cards (Iris): title 16, one metadata line, the reason in a caption. */}
          <View style={{ paddingVertical: tokens.space.md - tokens.space.xxs, paddingHorizontal: tokens.space.md, gap: tokens.space.xs }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.md }}>
              <Text variant="cardTitle" style={{ flex: 1 }}>
                {t("flows.places.placesFor", { region: name })}
              </Text>
              <Switch
                label={t("flows.places.include", { region: name })}
                value={selected?.id === region.id}
                onValueChange={(v) => onChange(v ? region : null)}
              />
            </View>
            <MetaLine
              variant="caption"
              items={[
                t("flows.places.meta", { places: formatCount(region.poiCount, lang), size: formatBytes(region.sizeBytes, lang) }),
                t("flows.places.cityCount", { count: cities.names.length + cities.more, value: formatCount(cities.names.length + cities.more, lang) }),
              ]}
            />
            <Text variant="caption" color="secondary">
              {t(`flows.places.reason.${suggestion!.reason}`)}
            </Text>
          </View>
        </>
      ) : (
        <ListRow title={t("flows.places.noRegionHere")} />
      )}
      {suggestion?.reason !== "location" && (
        <View style={{ padding: tokens.space.base, gap: tokens.space.sm }}>
          <Button ref={locateRef} size="sm" variant="secondary" icon="map-pin" label={t("flows.places.useLocation")} loading={locating} onPress={useLocation} />
          {locationNote && (
            <Text variant="footnote" color="secondary">
              {locationNote}
            </Text>
          )}
          {declined && <Button size="sm" variant="ghost" label={t("flows.places.openSettings")} onPress={() => Linking.openSettings()} />}
        </View>
      )}
      {regions.length > 1 && (
        <View style={{ paddingHorizontal: tokens.space.base, paddingBottom: tokens.space.base }}>
          <Button ref={otherRef} size="sm" variant="ghost" icon="map" label={t("flows.places.otherRegion")} onPress={() => setPickerOpen(true)} />
        </View>
      )}
      {trip ? (
        <ListRow
          icon="navigation"
          title={t("flows.travel.tripChosen", { label: trip.label })}
          value={formatBytes(trip.assets.reduce((n, a) => n + a.sizeBytes, 0), lang)}
          switch={{ value: true, onValueChange: (v) => !v && onTrip(null) }}
        />
      ) : (
        <View style={{ paddingHorizontal: tokens.space.base, paddingBottom: tokens.space.base }}>
          <Button ref={tripRef} size="sm" variant="outline" icon="navigation" label={t("flows.travel.goingTo")} onPress={() => setTripOpen(true)} />
        </View>
      )}
      <Sheet visible={tripOpen} onClose={() => setTripOpen(false)} title={t("flows.travel.goingTo")} returnFocusRef={tripRef}>
        <CitySearch
          catalog={catalog}
          onChoose={(choice) => {
            onTrip(choice);
            setTripOpen(false);
          }}
        />
      </Sheet>
      <Sheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title={t("flows.places.otherRegion")} returnFocusRef={otherRef}>
        <View accessibilityRole="radiogroup">
          {regions.map((r) => (
            <RadioRow
              key={r.id}
              title={lang.startsWith("pt") ? r.name.pt : r.name.en}
              subtitle={t("flows.places.meta", { places: formatCount(r.poiCount, lang), size: formatBytes(r.sizeBytes, lang) })}
              selected={suggestion?.region.id === r.id}
              onPress={() => {
                // Picking a region means wanting it: include it right away.
                setManual(r);
                onChange(r);
                setPickerOpen(false);
              }}
            />
          ))}
        </View>
      </Sheet>
      <Sheet
        visible={explainOpen}
        returnFocusRef={locateRef}
        onClose={() => answerExplain(false)}
        title={t("flows.places.rationaleTitle")}
        description={t("flows.places.rationaleBody")}
        footer={
          <>
            <Button label={t("flows.places.notNow")} variant="secondary" fullWidth onPress={() => answerExplain(false)} />
            <Button label={t("flows.places.continue")} fullWidth onPress={() => answerExplain(true)} />
          </>
        }
      />
    </Section>
  );
}


/** The one-word status at the right of an install row; the full line is what a screen reader hears. */
function shortStatus(state: RowState, model: CatalogModel, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (state.kind) {
    case "not-installed":
      return t(canDownload(model) ? "flows.onboarding.queued" : "flows.onboarding.toImport");
    case "downloading":
      return state.progress > 0 ? `${Math.round(state.progress * 100)}%` : t("flows.onboarding.queued");
    case "verifying":
      return t("flows.onboarding.checking");
    case "failed":
      return t("flows.onboarding.failedShort");
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
  onChoosePackage,
  onReady,
  answerModel,
  placesLabel,
}: {
  titleRef: React.RefObject<RNText | null>;
  assets: CatalogModel[];
  catalog: ReturnType<typeof useCatalog>;
  allPresent: boolean;
  lang: string;
  onBack: () => void;
  onChoosePackage: () => void;
  onReady: () => void;
  /** For the closing summary: what will answer, and the places chosen (region or trip). */
  answerModel?: CatalogModel;
  placesLabel?: string;
}) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const announce = useAnnounce();
  const [indexPhase, setIndexPhase] = useState<IndexPhase>("waiting");
  const [indexError, setIndexError] = useState<string | null>(null);
  const [seed, setSeed] = useState<SeedProgress | null>(null);
  const seedStart = useRef<{ at: number; done: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const offline = !networkAllowed();
  // Offline build, or items with no published URL yet (places packs): those are imported.
  const needsImport = offline || assets.some((a) => !canDownload(a) && !catalog.statuses[a.id]?.present);

  const states = assets.map((a) => ({ asset: a, state: catalog.view(a).state }));
  const downloading = states.some((s) => s.state.kind === "downloading" || s.state.kind === "verifying");
  const failed = states.filter((s) => s.state.kind === "failed");
  const noSpaceFailure = failed.some((f) => f.state.kind === "failed" && f.state.errorKind === "storage");

  // A new failure is announced right away and focus moves to the retry button (Prism F5).
  const retryRef = useRef<View>(null);
  const failedKey = failed.map((f) => f.asset.id).join(",");
  const lastFailedKey = useRef("");
  useEffect(() => {
    if (failedKey && failedKey !== lastFailedKey.current) {
      const first = failed[0];
      const reason = first.state.kind === "failed" ? failureLines(first.state, t, lang).cause : "";
      announce(`${t("flows.onboarding.downloadFailed")}. ${first.asset.label}: ${reason}`, { assertive: true });
      setTimeout(() => {
        const node = retryRef.current && findNodeHandle(retryRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      }, 300);
    }
    lastFailedKey.current = failedKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedKey]);

  // Announce the switch to verification once per asset.
  const verifyingKey = states.filter((s) => s.state.kind === "verifying").map((s) => s.asset.id).join(",");
  useEffect(() => {
    if (verifyingKey) announce(t("flows.row.verifying"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifyingKey]);

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
  // The file being checked right now (offline import): the hero shows it live (Prism/Iris S3C-1).
  const activeImport = catalog.imports.find((f) => f.status === "importing");
  const transferring = downloading || !!activeImport;
  // Measured download speed since this screen started receiving bytes: the time left is shown only once measured.
  const rateStart = useRef<{ bytes: number; at: number } | null>(null);
  if (downloading && !rateStart.current && doneBytes > 0) rateStart.current = { bytes: doneBytes, at: Date.now() };
  const etaS = (() => {
    const r = rateStart.current;
    if (!r || !downloading) return undefined;
    const elapsedS = (now - r.at) / 1000;
    const bps = (doneBytes - r.bytes) / Math.max(elapsedS, 1);
    return elapsedS >= 5 && bps > 0 ? (totalBytes - doneBytes) / bps : undefined;
  })();

  // Announce every quarter of the download, never per tick (Prism F4).
  const quarter = totalBytes > 0 ? Math.floor((doneBytes / totalBytes) * 4) : 0;
  const lastQuarter = useRef(quarter);
  useEffect(() => {
    if (quarter > lastQuarter.current && quarter < 4) announce(t(offline ? "flows.onboarding.percentImportedAnnounce" : "flows.onboarding.percentAnnounce", { pct: quarter * 25 }));
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
  const indexing = indexPhase === "building" || indexPhase === "error";
  const { fontScale } = useWindowDimensions();
  const indexCounter = seed ? t("flows.onboarding.indexCounter", { done: formatCount(seed.done, lang), total: formatCount(seed.total, lang) }) : "";
  // The item whose bytes are arriving now, "Item 2 of 5 — name" under the bar (the mockup's "Model 1 of 3 — …").
  const currentIdx = states.findIndex((x) => moving(x.state));
  const current = currentIdx >= 0 ? { n: currentIdx + 1, label: states[currentIdx].asset.label } : undefined;
  const presentCount = states.filter((s) => s.state.kind === "installed" || s.state.kind === "in-use").length;
  // The offline build imports: its hero counts files and only appears once one is in; before that the list says it all (Iris, Prism N-5/N-6).
  const hero = !allPresent
    ? offline && activeImport
      ? {
          label: t("flows.onboarding.importingLabel"),
          fraction: activeImport.progress,
          figure: undefined,
          meta: activeImport.sizeBytes
            ? [t("flows.onboarding.totalValue", { done: formatBytes(activeImport.sizeBytes * activeImport.progress, lang), total: formatBytes(activeImport.sizeBytes, lang) })]
            : [],
        }
      : offline
      ? {
          label: t("flows.onboarding.importedLabel"),
          fraction: assets.length > 0 ? presentCount / assets.length : 0,
          figure: { value: formatCount(presentCount, lang), unit: t("flows.onboarding.ofFiles", { count: assets.length, total: formatCount(assets.length, lang) }) },
          meta: [t("flows.onboarding.totalValue", { done: formatBytes(doneBytes, lang), total: formatBytes(totalBytes, lang) })],
        }
      : {
          label: t("flows.onboarding.totalLabel"),
          fraction: totalBytes > 0 ? doneBytes / totalBytes : 0,
          figure: undefined,
          meta: [t("flows.onboarding.totalValue", { done: formatBytes(doneBytes, lang), total: formatBytes(totalBytes, lang) })],
        }
    : {
        figure: undefined,
        label: t("flows.onboarding.indexRow"),
        fraction: seed && seed.total > 0 ? seed.done / seed.total : 0,
        meta: [indexCounter, seedEta != null ? t("flows.onboarding.minutesLeft", { count: minutesLeft(seedEta) }) : null].filter((x): x is string => !!x),
      };
  // One row per category, like the mockup (Iris, Prism): aggregated honestly, files one tap away.
  // The file being copied belongs to an item only once verified; its likely item (same size, or the same
  // name without case/punctuation) lets that category read "Importing" in ember meanwhile (the mockup's STREAMING row).
  const copyTarget = activeImport ? likelyTarget(activeImport, assets.filter((a) => !catalog.statuses[a.id]?.present)) : undefined;
  const importingItem = (asset: CatalogModel) => !!copyTarget && copyTarget.id === asset.id;
  const categories = installCategories(
    states.map(({ asset, state }) => ({
      id: asset.id,
      kind: asset.kind,
      sizeBytes: asset.sizeBytes,
      state: importingItem(asset) ? ({ kind: "downloading", phase: "copying", progress: activeImport!.progress } as const) : state,
      importOnly: !canDownload(asset),
    }))
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Verified files that are not part of this setup (an optional pack picked with the others) are listed
  // in the list card, never as a loose line under it (Prism A3-2).
  const extras = catalog.imports
    .filter((f) => f.status === "verified" && f.assetId && !assets.some((a) => a.id === f.assetId))
    .map((f) => findAsset(f.assetId!)?.label ?? f.name);
  // The last screen before the chat: centred, one figure-free summary of what is now on the phone (Prism N-13).
  if (ready) {
    const collections = assets.filter((a) => a.kind === "corpus" && !a.id.startsWith("poi-")).length;
    const summary = [
      answerModel && { key: "doneAnswer", value: answerModel.label },
      collections > 0 && { key: "doneKnowledge", value: t("flows.onboarding.doneCollections", { count: collections, value: formatCount(collections, lang) }) },
      placesLabel && { key: "donePlaces", value: placesLabel },
      seed && seed.total > 0 && { key: "doneIndex", value: t("flows.onboarding.doneArticles", { count: seed.total, value: formatCount(seed.total, lang) }) },
    ].filter((r): r is { key: string; value: string } => !!r);
    return (
      // ambient: the same ember light as the Welcome, so both ends of setup rhyme (Iris).
      <Screen center ambient edges={["top", "bottom", "left", "right"]} footer={<Button size="lg" label={t("flows.onboarding.open")} fullWidth onPress={onReady} />}>
        <View style={{ alignItems: "center", gap: tokens.space.md }}>
          <Mascot size="hero" glow />
          <Text ref={titleRef} variant="title1" align="center" header>
            {t("flows.onboarding.doneTitle")}
          </Text>
          <Text variant="footnote" color="secondary" align="center">
            {t("flows.onboarding.doneBody")}
          </Text>
        </View>
        {summary.length > 0 && (
          <Card>
            <Text variant="label" color="secondary">
              {t("flows.onboarding.doneSummary")}
            </Text>
            {summary.map((r, i) => (
              <View
                key={r.key}
                accessible
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: tokens.space.md,
                  paddingTop: tokens.space.md,
                  paddingBottom: i < summary.length - 1 ? tokens.space.md : 0,
                  borderBottomWidth: i < summary.length - 1 ? tokens.size.hairline : 0,
                  borderBottomColor: tokens.color.line.hairline,
                }}
              >
                <Text variant="footnote" color="secondary">
                  {t(`flows.onboarding.${r.key}`)}
                </Text>
                <Text variant="footnote" align="right" style={{ flex: 1 }}>
                  {r.value}
                </Text>
              </View>
            ))}
          </Card>
        )}
      </Screen>
    );
  }

  return (
    <Screen
      contentStyle={setupRhythm(tokens)}
      edges={["top", "bottom", "left", "right"]}
      footer={
        <>
          {offline && !allPresent && !activeImport ? (
            // Offline, the step's action is choosing the files: it takes the mockup's CTA place (primary, the one accent).
            <Button
              size="lg"
              icon="file-plus"
              label={t("flows.import.pick")}
              fullWidth
              onPress={catalog.importFiles}
            />
          ) : (
            // The mockup's CTA: large, disabled until everything is on the phone, and it says why (Iris §3, Prism).
            <Button size="lg" label={t("flows.onboarding.open")} fullWidth disabled accessibilityHint={t("flows.onboarding.openWhenReady")} onPress={onReady} />
          )}
          {/* No Back while bytes move (download or import), as in the mockup; it returns when nothing is
              transferring (nothing imported yet, or a failure), and the CTA moves up with it (Iris). */}
          {!transferring && indexPhase !== "building" && <BackLink label={t("flows.onboarding.back")} onPress={onBack} />}
        </>
      }
    >
      <StepHeader
        titleRef={titleRef}
        stage={indexPhase === "waiting" ? 2 : 3}
        // Once the files are in, the header describes the offline indexing, not the download (Harbor, iOS shot 04).
        title={t(`flows.onboarding.${ready ? "doneTitle" : indexing ? "indexTitle" : offline ? "importTitle" : "step3Title"}`)}
        subtitle={t(`flows.onboarding.${ready ? "doneBody" : indexing ? "indexSub" : offline ? "importSub" : "step3Sub"}`)}
      />


      {/* One hero: the download while files arrive, then the search index (the mockup's big figure). */}
      {((!allPresent && (!offline || presentCount > 0 || !!activeImport)) || (indexing && seed)) && (
        // The hero boar's glow is wider than the boar: the card clips it, as in the mockup (Prism N-11).
        // The mockup's hero (FIDELITY): radius 22, gap 10, the boar at right -6 / top -4 with its ember glow;
        // the bar runs full width under its feet. The glow is clipped by the card (Prism N-11).
        <Card style={{ gap: tokens.space.md - tokens.space.xxs, borderRadius: tokens.radius.hero }}>
          {fontScale > LARGE_TEXT ? (
            // The brand disc at large text is a framed avatar: it keeps the card's padding (Prism H-1).
            <View style={{ position: "absolute", top: tokens.space.base, right: tokens.space.base }}>
              <Mascot size="brand" />
            </View>
          ) : (
            // The mockup's boar overflows the card (top -4, right -6), unclipped (Iris §3).
            <View style={{ position: "absolute", top: -tokens.space.xs, right: -(tokens.space.xs + tokens.space.xxs) }}>
              <Mascot size="md" />
            </View>
          )}
          <View style={{ paddingRight: fontScale > LARGE_TEXT ? tokens.size.mascotSm + tokens.space.sm : tokens.size.mascotMd - tokens.space.xl }}>
            {/* xl only for the download, the one figure of the setup; the index and the file count stay lg (Iris). */}
            {hero.figure ? (
              <Stat size="lg" label={hero.label} value={hero.figure.value} unit={hero.figure.unit} />
            ) : (
              // "62%" is one run in the mockup; Stat draws unit="%" in the number's body (Iris 23a271b, Prism S3C-1).
              <Stat size={allPresent ? "lg" : "xl"} label={hero.label} value={String(Math.floor(hero.fraction * 100))} unit="%" />
            )}
          </View>
          <Progress label={hero.label} value={hero.fraction} valueText={hero.meta.join(", ")} height={tokens.space.sm + tokens.space.xxs} />
          {!allPresent && offline && activeImport && (
            <Text variant="footnote" numberOfLines={1} ellipsizeMode="middle">
              {t("flows.onboarding.fileOf", { n: Math.min(presentCount + 1, assets.length), total: assets.length, name: activeImport.name })}
            </Text>
          )}
          {!allPresent && !offline && current && (
            <Text variant="footnote" numberOfLines={2}>
              {t("flows.onboarding.currentItem", { n: current.n, total: states.length, name: current.label })}
            </Text>
          )}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: tokens.space.md }}>
            <MetaLine items={hero.meta} />
            {!allPresent && etaS != null && <MetaLine items={[t("flows.onboarding.minutesLeft", { count: minutesLeft(etaS) })]} />}
            {offline && activeImport && (
              // The copy's Cancel sits in the mockup's ETA slot, next to the progress it stops; neutral, not ember,
              // so it doesn't compete with the bar; 44 pt touch from hitSlop (Iris, Prism).
              <TextAction
                label={t("common.cancel")}
                accessibilityLabel={t("flows.import.cancelA11y", { name: activeImport.name })}
                onPress={catalog.cancelImports}
              />
            )}
          </View>
        </Card>
      )}

      {/* The mockup's list card: 4/14 padding, rows 9 pt tall padding, status in small caps (FIDELITY). */}
      <Card padding="none" style={{ paddingHorizontal: tokens.space.md + tokens.space.xxs, paddingVertical: tokens.space.xs }}>
        {categories.map((c, i) => (
          <CategoryRow
            key={c.category}
            row={c}
            first={i === 0}
            assets={assets}
            expanded={!!expanded[c.category]}
            onToggle={() => setExpanded((e) => ({ ...e, [c.category]: !e[c.category] }))}
            onRetry={(asset) => catalog.download(asset)}
            lang={lang}
            importing={offline}
          />
        ))}
        {extras.length > 0 && (
          <View
            accessible
            accessibilityLabel={`${t("flows.onboarding.category.extras")}: ${extras.join(", ")}`}
            style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.md - tokens.space.xxs, paddingVertical: tokens.space.sm, borderTopWidth: tokens.size.hairline, borderTopColor: tokens.color.line.row }}
          >
            <Icon name="plus-circle" size="sm" color={tokens.color.status.success.solid} />
            <View style={{ flex: 1 }}>
              <Text variant="subhead">{t("flows.onboarding.category.extras")}</Text>
              <Text variant="caption" color="secondary" numberOfLines={2}>
                {extras.join(", ")}
              </Text>
            </View>
            <Text variant="label" color="secondary">
              {t("flows.onboarding.categoryStatus.ready")}
            </Text>
          </View>
        )}
        {[
          {
            key: "index",
            icon: (
              <Icon
                name={ready ? "check-circle" : indexPhase === "error" ? "alert-octagon" : "clock"}
                color={ready ? tokens.color.status.success.solid : indexPhase === "error" ? tokens.color.status.danger.solid : tokens.color.text.secondary}
              />
            ),
            title: t("flows.onboarding.indexRow"),
            status:
              indexPhase === "building" && seed
                ? indexCounter
                : indexPhase === "waiting"
                  ? t("flows.onboarding.waitingDownloads")
                  : indexPhase === "building"
                    ? t("flows.onboarding.indexStarting")
                    : t("flows.onboarding.indexFailed"),
            spoken: undefined,
            // The hero carries the index progress in accent; the row stays secondary (R-IDX-2).
            tone: (indexPhase === "error" ? "danger" : "secondary") as TextColor,
          },
        ]
          // While the hero shows the index, its row would repeat it (Prism N-10).
          .filter((row) => !(row.key === "index" && indexing && seed))
          .map((row, i, rows) => (
          <React.Fragment key={row.key}>
          <View
            accessible
            accessibilityLabel={`${row.title}, ${row.spoken ?? row.status}`}
            style={{
              gap: tokens.space.xs,
              paddingVertical: tokens.space.sm,
              borderTopWidth: categories.length > 0 || i > 0 ? tokens.size.hairline : 0,
              borderTopColor: tokens.color.line.row,
            }}
          >
            <View style={{ flexDirection: "row", gap: tokens.space.sm, alignItems: "center" }}>
              {row.icon}
              <Text variant="subhead" style={{ flex: 1 }} numberOfLines={2}>
                {row.title}
              </Text>
              {row.key !== "index" && (
                // Small caps like the mockup's STREAMING / QUEUED / PENDING.
                <Text variant="label" color={row.tone} numeric>
                  {row.status}
                </Text>
              )}
            </View>
            {row.key === "index" && (
              <Text variant="footnote" color={row.tone} numeric>
                {row.status}
              </Text>
            )}
          </View>
          </React.Fragment>
        ))}
      </Card>


      {/* Mockup order: hero, list, then this; with one row per category it stays on the first screen (Iris). */}
      {(transferring || indexPhase === "building") && (
        // The mockup's warning card: warm wash, radius 18, 12/14 padding, body in the primary ink (FIDELITY).
        <View
          style={{
            gap: tokens.space.xs,
            backgroundColor: tokens.color.status.warning.soft,
            borderRadius: tokens.radius.lg - tokens.space.xxs,
            paddingVertical: tokens.space.md,
            paddingHorizontal: tokens.space.md + tokens.space.xxs,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.sm }}>
            <Icon name="alert-triangle" size="sm" color={tokens.color.status.warning.solid} />
            <Text variant="label" color="warning">
              {t("flows.onboarding.keepOpenTitle")}
            </Text>
          </View>
          <Text variant="footnote">
            {/* Indexing runs in the app's JS, which the OS may suspend in the background (Prism IX-2). */}
            {t(indexPhase === "building" && !transferring ? "flows.onboarding.keepOpenIndex" : offline ? "flows.onboarding.keepOpenImport" : "flows.onboarding.keepOpen")}
          </Text>
        </View>
      )}

      {/* The files being imported come after "Keep BOAR open", so that card stays on the first screen (Harbor, 02e72b5). */}
      {needsImport && !allPresent && (
        <View style={{ gap: tokens.space.sm }}>
          {!offline && (
            <Text variant="footnote" color="secondary">
              {t("flows.onboarding.importPlacesNote")}
            </Text>
          )}
          {/* Offline, choosing files is the footer's CTA (the mockup's place for the step's action); this lists them. */}
          <ImportList imports={catalog.imports} onPick={catalog.importFiles} onCancel={catalog.cancelImports} hidePick={offline} hideActive={offline} hideVerified />
          {!activeImport && (
            <Text variant="footnote" color="secondary" selectable>
              {t("flows.onboarding.importHow")}
            </Text>
          )}
        </View>
      )}

      {failed.length > 0 && (
        <View
          style={{
            gap: tokens.space.sm,
            padding: tokens.space.base,
            borderRadius: tokens.radius.md,
            backgroundColor: tokens.color.status.danger.soft,
          }}
        >
          <View style={{ flexDirection: "row", gap: tokens.space.sm, alignItems: "center" }}>
            <Icon name="alert-octagon" color={tokens.color.status.danger.solid} />
            <Text variant="headline" color="danger" header>
              {t("flows.onboarding.downloadFailed")}
            </Text>
          </View>
          {failed.map((f) => {
            if (f.state.kind !== "failed") return null;
            const lines = failureLines(f.state, t, lang);
            return (
              <View key={f.asset.id} style={{ gap: tokens.space.xxs }}>
                <Text variant="callout">
                  {f.asset.label}: {lines.cause}
                </Text>
                <Text variant="caption" color="secondary" selectable>
                  {lines.detail}
                </Text>
              </View>
            );
          })}
          <Button ref={retryRef} label={t("flows.row.retry")} icon="refresh-cw" onPress={() => failed.forEach((f) => catalog.download(f.asset))} />
          {noSpaceFailure && <Button label={t("flows.onboarding.smallerPackage")} variant="secondary" onPress={onChoosePackage} />}
        </View>
      )}

      {indexPhase === "error" && (
        <EmptyState tone="error" title={t("flows.onboarding.indexFailed")} body={indexError ?? undefined} actionLabel={t("flows.row.retry")} onAction={buildIndex} />
      )}

      {stalled && !offline && (
        <Button
          variant="secondary"
          icon="refresh-cw"
          label={t("flows.onboarding.restart")}
          onPress={() => {
            for (const { asset, state } of states) if (state.kind !== "installed" && state.kind !== "in-use") restartDownload(asset).finally(() => catalog.refresh());
          }}
        />
      )}

    </Screen>
  );
}

/** Bytes are arriving or being checked. A download that has not started yet reads as waiting: one accent per screen (Prism S3-2). */
function moving(state: RowState): boolean {
  return (state.kind === "downloading" && state.progress > 0) || state.kind === "verifying";
}

/** The mockup's back link: 13.5 text in mu with an arrow, not an accent button; touch >= 44 (Prism). */
function BackLink({ label, onPress }: { label: string; onPress: () => void }) {
  const tokens = useTokens();
  return (
    // 10 pt below the CTA like the mockup (the footer's gap is 8).
    <View style={{ alignSelf: "center", marginTop: tokens.space.xxs }}>
      <TextAction label={label} leadingIcon="arrow-left" onPress={onPress} />
    </View>
  );
}

const CATEGORY_ICON: Record<InstallCategory, IconName> = { answer: "cpu", search: "database", knowledge: "book-open", places: "map-pin" };

/**
 * One install category (the mockup's "Reasoning Models ... STREAMING"). Reads as one sentence; a tap shows
 * each file with its status and, for a failed one, Try again (Prism: honest status, files reachable).
 */
function CategoryRow({
  row,
  first,
  assets,
  expanded,
  onToggle,
  onRetry,
  lang,
  importing,
}: {
  row: ReturnType<typeof installCategories>[number];
  first: boolean;
  assets: CatalogModel[];
  expanded: boolean;
  onToggle: () => void;
  onRetry: (asset: CatalogModel) => void;
  lang: string;
  /** Offline build: bytes arrive by import, so a moving row reads "Importing". */
  importing?: boolean;
}) {
  const { t } = useTranslation();
  const tokens = useTokens();
  const name = t(`flows.onboarding.category.${row.category}`);
  const failedItem = row.items.find((i) => i.state.kind === "failed");
  const reason = failedItem && failedItem.state.kind === "failed" ? failureLines(failedItem.state, t, lang).cause : undefined;
  const status = t(`flows.onboarding.categoryStatus.${row.status === "moving" && importing ? "importing" : row.status}`);
  const pct = Math.floor(row.fraction * 100);
  const icon: IconName = row.status === "failed" ? "alert-octagon" : row.status === "moving" ? "download" : row.status === "ready" ? "check-circle" : CATEGORY_ICON[row.category];
  const iconColor =
    row.status === "failed"
      ? tokens.color.status.danger.solid
      : row.status === "moving"
        ? tokens.color.accent.text
        : row.status === "ready"
          ? tokens.color.status.success.solid
          : tokens.color.text.secondary;
  const tone: TextColor = row.status === "failed" ? "danger" : row.status === "moving" ? "accent" : "secondary";
  return (
    <View style={{ borderTopWidth: first ? 0 : tokens.size.hairline, borderTopColor: tokens.color.line.row }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityHint={t("flows.onboarding.categoryHint")}
        accessibilityLabel={[
          t("flows.onboarding.categoryA11y", { name, done: row.done, total: row.total, pct }),
          row.status === "failed" ? `${status}: ${reason ?? ""}` : status,
        ].join(", ")}
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.md - tokens.space.xxs, paddingVertical: tokens.space.sm, minHeight: tokens.size.touch }}
      >
        <Icon name={icon} size="sm" color={iconColor} />
        <View style={{ flex: 1 }}>
          <Text variant="subhead">{name}</Text>
          {reason && (
            <Text variant="caption" color="danger">
              {reason}
            </Text>
          )}
        </View>
        <Text variant="label" color={tone}>
          {status}
        </Text>
      </Pressable>
      {expanded &&
        row.items.map((it) => {
          const asset = assets.find((a) => a.id === it.id)!;
          return (
            <View
              key={it.id}
              style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.sm, paddingLeft: tokens.space.xl, paddingBottom: tokens.space.sm }}
            >
              <Text variant="footnote" color="secondary" style={{ flex: 1 }} numberOfLines={2}>
                {asset.label}
              </Text>
              {it.state.kind === "failed" ? (
                <Button size="sm" variant="secondary" label={t("flows.row.retry")} accessibilityLabel={`${t("flows.row.retry")}: ${asset.label}`} onPress={() => onRetry(asset)} />
              ) : (
                <Text variant="caption" color={moving(it.state) ? "accent" : "secondary"} numeric>
                  {shortStatus(it.state, asset, t)}
                </Text>
              )}
            </View>
          );
        })}
    </View>
  );
}

