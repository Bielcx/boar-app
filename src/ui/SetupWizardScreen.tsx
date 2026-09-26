/**
 * First-run setup in three steps: welcome → capacity package → install and
 * index. Every number shown is measured on the device or computed from the
 * manifest (flows-spec §4.1); nothing is typed in by hand.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, AppState, BackHandler, findNodeHandle, Image, Linking, Text as RNText, useWindowDimensions, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Badge, Button, Card, EmptyState, Icon, IconName, ListRow, MetaLine, OptionCard, Progress, Screen, Section, Sheet, Stat, Stepper, Text, useAnnounce } from "./components";
import type { TextColor } from "./components/Text";
import { useTokens } from "./theme";
import { impact, ImpactFeedbackStyle, notification, NotificationFeedbackType } from "../services/haptics";
import { useLanguage } from "../i18n/LanguageContext";
import { getSetupProgress, LanguageId, setActiveModelId, setSetupProgress } from "../models/settings";
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

interface Props {
  onReady: () => void;
  /** Present when setup was reopened from Settings: lets the user leave without finishing. */
  onSkip?: () => void;
}

type Step = 1 | 2 | 3;
type IndexPhase = "waiting" | "building" | "ready" | "error";

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
        setPackageChosen(true);
        setAnswerChosen(true);
        const region = p.travelRegionId ? poiRegions().find((r) => r.id === p.travelRegionId) : undefined;
        if (region) setTravel(region);
        setStep(p.step);
      }
      setRestored(true);
    });
  }, []);
  useEffect(() => {
    if (restored) setSetupProgress({ step, packageId, travelRegionId: travel?.id, answerTier });
  }, [restored, step, packageId, travel, answerTier]);
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
          onSkip={onSkip}
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
    <View style={{ gap: tokens.space.xl }}>
      <SetupStepper stage={stage} />
      <View style={{ gap: tokens.space.xs }}>
        <Text ref={titleRef} variant="title2" header>
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
  const points: { icon: IconName; key: string }[] = [
    { icon: "wifi-off", key: "point1" },
    { icon: "shield", key: "point2" },
    { icon: "book", key: "point3" },
  ];
  // Measured on this phone; a value the OS would not give is left out, never guessed.
  const phone = [
    { key: "phoneMemory", bytes: deviceRamBytes },
    { key: "phoneFree", bytes: freeBytes },
  ].filter((r) => r.bytes > 0);
  return (
    <Screen
      ambient
      edges={["top", "bottom", "left", "right"]}
      footer={
        <>
          <Button label={t("flows.onboarding.start")} icon="arrow-right" iconPosition="end" fullWidth onPress={onNext} />
          {onSkip && <Button label={t("flows.onboarding.backToApp")} variant="ghost" fullWidth onPress={onSkip} />}
        </>
      }
    >
      <SetupStepper stage={0} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: tokens.space.md }}>
        <Image
          source={require("../../assets/boar.png")}
          style={{ width: tokens.size.mascotSm, height: tokens.size.mascotSm, borderRadius: tokens.radius.full }}
          accessible={false}
        />
        <View style={{ flex: 1, gap: tokens.space.xxs }}>
          <Text ref={titleRef} variant="title1" header>
            BOAR
          </Text>
          <Text variant="footnote" color="field">
            {t("flows.onboarding.brandSub")}
          </Text>
        </View>
      </View>
      <Card style={{ gap: tokens.space.md }}>
        <Text variant="label" color="field">
          {t("flows.onboarding.introLabel")}
        </Text>
        <Text variant="body">{t("flows.onboarding.tagline")}</Text>
        <View style={{ gap: tokens.space.sm }}>
          {points.map((p) => (
            <View key={p.key} style={{ flexDirection: "row", gap: tokens.space.sm, alignItems: "center" }}>
              <Icon name={p.icon} size="sm" color={tokens.color.text.secondary} />
              <Text variant="footnote" color="secondary" style={{ flex: 1 }}>
                {t(`flows.onboarding.${p.key}`)}
              </Text>
            </View>
          ))}
        </View>
      </Card>
      <View style={{ gap: tokens.space.sm }}>
        <Text variant="label" color="secondary">
          {t("flows.settings.language")}
        </Text>
        {/* Side by side like the mockup; stacked when large text would break "Português". */}
        <View accessibilityRole="radiogroup" style={{ flexDirection: fontScale > LARGE_TEXT ? "column" : "row", gap: tokens.space.md }}>
          {LANGUAGES.map((l) => (
            <View key={l.id} style={fontScale > LARGE_TEXT ? undefined : { flex: 1 }}>
              <OptionCard
                title={l.name}
                indicator="check"
                selected={languageId === l.id}
                onPress={async () => {
                  await setLanguage(l.id);
                  announce(i18n.getFixedT(l.id)("flows.onboarding.languageAnnounce"));
                }}
              />
            </View>
          ))}
        </View>
      </View>
      {phone.length > 0 && (
        <Card>
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
                paddingTop: tokens.space.md,
                paddingBottom: i < phone.length - 1 ? tokens.space.md : 0,
                borderBottomWidth: i < phone.length - 1 ? tokens.size.hairline : 0,
                borderBottomColor: tokens.color.line.hairline,
              }}
            >
              <Text variant="footnote" color="secondary">
                {t(`flows.onboarding.${r.key}`)}
              </Text>
              <Text variant="mono" numeric>
                {formatBytes(r.bytes, lang)}
              </Text>
            </View>
          ))}
        </Card>
      )}
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
      edges={["top", "bottom", "left", "right"]}
      footer={
        <>
          <Button
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
          <Button label={t("flows.onboarding.back")} variant="ghost" fullWidth onPress={onBack} />
        </>
      }
    >
      <StepHeader titleRef={titleRef} stage={1} title={t("flows.onboarding.step2Title")} subtitle={t("flows.onboarding.step2Sub")} />
      <Text variant="mono" color="secondary" numeric>
        {deviceRamBytes > 0 || freeBytes > 0
          ? t("flows.onboarding.device", {
              ram: deviceRamBytes > 0 ? formatBytes(deviceRamBytes, lang) : t("flows.onboarding.unknown"),
              free: freeBytes > 0 ? formatBytes(freeBytes, lang) : t("flows.onboarding.unknown"),
            })
          : t("flows.onboarding.deviceUnknown")}
      </Text>
      <View accessibilityRole="radiogroup" style={{ gap: tokens.space.md }}>
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
              badge={p.id === recommended ? <Badge label={t("flows.onboarding.recommended")} tone="accent" /> : undefined}
              // The one number that decides: what this choice downloads (or imports) now.
              trailing={p.plan.downloadBytes > 0 ? formatBytes(p.plan.downloadBytes, lang) : undefined}
              description={t(`flows.onboarding.package.${p.id}.body`)}
              meta={[
                p.plan.downloadBytes === 0 && t("flows.onboarding.alreadyDownloaded"),
                t("flows.onboarding.meta.onDisk", { size: formatBytes(p.plan.installedBytes, lang) }),
                !offline &&
                  p.seconds != null &&
                  p.plan.downloadBytes > 0 &&
                  t("flows.onboarding.meta.time", { minutes: minutesLeft(p.seconds), speed: formatBytes(REFERENCE_BYTES_PER_SEC, lang) }),
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
      {choices.compact && choices.default && (
        <View style={{ gap: tokens.space.md }}>
          <Text variant="label" color="secondary">
            {t("flows.onboarding.answerModelTitle")}
          </Text>
          <View accessibilityRole="radiogroup" style={{ gap: tokens.space.md }}>
            {(["default", "compact"] as const).map((tierId) => {
              const m = choices[tierId]!;
              return (
                <OptionCard
                  key={tierId}
                  title={t(`flows.onboarding.answerTier.${tierId}`, { name: m.label })}
                  selected={answerTier === tierId}
                  onPress={() => onUserAnswer(tierId)}
                  badge={tierId === recommendedTier ? <Badge label={t("flows.onboarding.suggestedHere")} tone="accent" /> : undefined}
                  trailing={formatBytes(m.sizeBytes, lang)}
                />
              );
            })}
          </View>
          <Text variant="footnote" color="secondary">
            {compactSuggested
              ? pick?.reason === "compact-low-ram"
                ? t("flows.onboarding.compactLowRam", { ram: formatBytes(COMPACT_ONLY_MAX_RAM_BYTES, lang) })
                : t("flows.onboarding.compactWhy")
              : t("flows.onboarding.answerModelFooter")}
          </Text>
        </View>
      )}
      <TravelCard selected={travel} onChange={onTravel} lang={lang} trip={trip} onTrip={onTrip} catalog={catalog} />
      <Text variant="footnote" color="secondary">
        {t("flows.onboarding.laterNote")}
      </Text>
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
          <ListRow
            title={t("flows.places.include", { region: name })}
            subtitle={[
              t("flows.places.meta", { places: formatCount(region.poiCount, lang), size: formatBytes(region.sizeBytes, lang) }),
              cities.more > 0 ? t("flows.places.citiesMore", { cities: cities.names.join(", "), count: cities.more }) : cities.names.join(", "),
              t(`flows.places.reason.${suggestion!.reason}`),
            ].join("\n")}
            switch={{ value: selected?.id === region.id, onValueChange: (v) => onChange(v ? region : null) }}
          />
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

function statusLine(state: RowState, model: CatalogModel, t: ReturnType<typeof useTranslation>["t"], lang: string): string {
  switch (state.kind) {
    case "not-installed":
      return t(canDownload(model) ? "flows.onboarding.queued" : "flows.onboarding.toImport");
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

/** The one-word status at the right of an install row; the full line is what a screen reader hears. */
function shortStatus(state: RowState, model: CatalogModel, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (state.kind) {
    case "not-installed":
      return t(canDownload(model) ? "flows.onboarding.queued" : "flows.onboarding.toImport");
    case "downloading":
      return `${Math.round(state.progress * 100)}%`;
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
}: {
  titleRef: React.RefObject<RNText | null>;
  assets: CatalogModel[];
  catalog: ReturnType<typeof useCatalog>;
  allPresent: boolean;
  lang: string;
  onBack: () => void;
  onChoosePackage: () => void;
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
      const reason = first.state.kind === "failed" ? t(`flows.row.error.${first.state.errorKind}`) : "";
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
        stage={indexPhase === "waiting" ? 2 : 3}
        title={ready ? t("flows.onboarding.doneTitle") : offline ? t("flows.onboarding.importTitle") : t("flows.onboarding.step3Title")}
        subtitle={ready ? t("flows.onboarding.doneBody") : offline ? t("flows.onboarding.importSub") : t("flows.onboarding.step3Sub")}
      />

      {needsImport && !allPresent && (
        <View style={{ gap: tokens.space.sm }}>
          {!offline && (
            <Text variant="footnote" color="secondary">
              {t("flows.onboarding.importPlacesNote")}
            </Text>
          )}
          <ImportList imports={catalog.imports} onPick={catalog.importFiles} onCancel={catalog.cancelImports} />
          <Text variant="footnote" color="secondary" selectable>
            {t("flows.onboarding.importHow")}
          </Text>
        </View>
      )}

      {!allPresent && (
        <Card style={{ gap: tokens.space.md }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: tokens.space.md }}>
            <Stat size="lg" label={t("flows.onboarding.totalLabel")} value={String(totalBytes > 0 ? Math.floor((doneBytes / totalBytes) * 100) : 0)} unit="%" />
            <Image
              source={require("../../assets/boar.png")}
              style={{ width: tokens.size.mascotSm, height: tokens.size.mascotSm, borderRadius: tokens.radius.full }}
              accessible={false}
            />
          </View>
          <Progress
            label={t("flows.onboarding.totalLabel")}
            value={totalBytes > 0 ? doneBytes / totalBytes : 0}
            valueText={t("flows.onboarding.totalValue", { done: formatBytes(doneBytes, lang), total: formatBytes(totalBytes, lang) })}
          />
          <MetaLine items={[t("flows.onboarding.totalValue", { done: formatBytes(doneBytes, lang), total: formatBytes(totalBytes, lang) })]} />
        </Card>
      )}

      <Card padding="none">
        {[
          ...states.map(({ asset, state }) => ({
            key: asset.id,
            icon: <PhaseIcon state={state} />,
            title: `${t(`flows.row.kind.${asset.kind}`)} · ${asset.label}`,
            status: shortStatus(state, asset, t),
            spoken: statusLine(state, asset, t, lang),
            tone: (state.kind === "failed" ? "danger" : state.kind === "downloading" || state.kind === "verifying" ? "accent" : "secondary") as TextColor,
          })),
          {
            key: "index",
            icon: (
              <Icon
                name={ready ? "check-circle" : indexPhase === "error" ? "alert-octagon" : "circle"}
                color={ready ? tokens.color.status.success.solid : indexPhase === "error" ? tokens.color.status.danger.solid : tokens.color.text.secondary}
              />
            ),
            title: t("flows.onboarding.indexRow"),
            status:
              indexPhase === "building" && seed
                ? t("flows.onboarding.indexCounter", { done: formatCount(seed.done, lang), total: formatCount(seed.total, lang) }) +
                  (seedEta != null ? ` · ${t("flows.onboarding.minutesLeft", { count: minutesLeft(seedEta) })}` : "")
                : indexPhase === "waiting"
                  ? t("flows.onboarding.waitingDownloads")
                  : indexPhase === "building"
                    ? t("flows.onboarding.indexStarting")
                    : indexPhase === "ready"
                      ? t("flows.onboarding.ready")
                      : t("flows.onboarding.indexFailed"),
            spoken: undefined,
            tone: (indexPhase === "error" ? "danger" : indexPhase === "building" ? "accent" : "secondary") as TextColor,
          },
        ].map((row, i, rows) => (
          <View
            key={row.key}
            accessible
            accessibilityLabel={`${row.title}, ${row.spoken ?? row.status}`}
            style={{
              gap: tokens.space.xs,
              paddingHorizontal: tokens.space.base,
              paddingVertical: tokens.space.md,
              borderBottomWidth: i < rows.length - 1 ? tokens.size.hairline : 0,
              borderBottomColor: tokens.color.line.hairline,
            }}
          >
            <View style={{ flexDirection: "row", gap: tokens.space.sm, alignItems: "center" }}>
              {row.icon}
              <Text variant="subhead" style={{ flex: 1 }} numberOfLines={2}>
                {row.title}
              </Text>
              {row.key !== "index" && (
                <Text variant="mono" color={row.tone} numeric>
                  {row.status}
                </Text>
              )}
            </View>
            {row.key === "index" && (
              <Text variant="footnote" color={row.tone} numeric>
                {row.status}
              </Text>
            )}
            {row.key === "index" && indexPhase === "building" && seed && (
              <Progress
                label={t("flows.onboarding.indexRow")}
                value={seed.done / seed.total}
                valueText={t("flows.onboarding.indexCounter", { done: formatCount(seed.done, lang), total: formatCount(seed.total, lang) })}
                tone="accent"
              />
            )}
          </View>
        ))}
      </Card>

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
          {failed.map((f) => (
            <View key={f.asset.id} style={{ gap: tokens.space.xxs }}>
              <Text variant="callout">
                {f.asset.label}: {t(`flows.row.error.${f.state.kind === "failed" ? f.state.errorKind : "unknown"}`)}
              </Text>
              {f.state.kind === "failed" && (
                <Text variant="caption" color="secondary" selectable>
                  {f.state.message}
                </Text>
              )}
            </View>
          ))}
          <Button ref={retryRef} label={t("flows.row.retry")} icon="refresh-cw" onPress={() => failed.forEach((f) => catalog.download(f.asset))} />
          {noSpaceFailure && <Button label={t("flows.onboarding.smallerPackage")} variant="secondary" onPress={onChoosePackage} />}
        </View>
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
  return <Icon name="circle" color={tokens.color.text.secondary} />;
}
