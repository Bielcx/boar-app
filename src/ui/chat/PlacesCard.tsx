import React, { useEffect, useState } from "react";
import { Linking, Pressable, useWindowDimensions, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { Badge, Banner, Button, Card, EmptyState, Icon, Sheet, Text, TextField, useToast } from "../components";
import { useTokens } from "../theme";
import type { Place } from "./answerEvents";
import type { AnswerState, PlacesResult } from "./answerReducer";
import {
  coordinatesText,
  cuisineLabels,
  dietLabels,
  formatDistance,
  geoUri,
  filterName,
  deviceClockApplies,
  openStateAt,
  openStateLabel,
  placesEmptyTitle,
  placeA11yLabel,
  sourceName,
} from "./placesFormat";

const VISIBLE = 5;

type T = (key: string, opts?: Record<string, unknown>) => string;

function cardTitle(r: PlacesResult, count: number, t: T): string {
  const filter = filterName(r.filters, t);
  return filter ? t("chat.places.titleFiltered", { filter, count }) : t("chat.places.title", { count });
}

function cardSubtitle(r: PlacesResult, locale: string, t: T): string {
  const parts: string[] = [];
  if (r.area.kind === "near") {
    parts.push(r.area.radiusM ? t("chat.places.within", { distance: formatDistance(r.area.radiusM, locale) }) : t("chat.places.nearYou"));
  } else {
    parts.push(t("chat.places.inCity", { city: r.area.place?.name ?? r.area.label ?? "" }));
  }
  // "Best" is never popularity: say how the list is ordered.
  parts.push(t(r.criterion === "distance" ? "chat.places.byDistance" : "chat.places.byDiet"));
  return parts.join(" · ");
}

/** The device clock, refreshed each minute so open/closed doesn't go stale in a long session. */
function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function PlaceRow({ place, now, locale, onPress }: { place: Place; now: Date | null; locale: string; onPress: () => void }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.6;
  const tags = [...dietLabels(place.diet, tr, place.dietFlag), ...cuisineLabels(place.cuisine)].join(" · ");
  const state = openStateAt(place, now);
  const distance = place.distanceM != null ? formatDistance(place.distanceM, locale) : null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={placeA11yLabel(place, now, locale, tr)}
      style={({ pressed }) => ({
        minHeight: t.size.touch + 8,
        paddingHorizontal: t.space.base,
        paddingVertical: t.space.sm,
        justifyContent: "center",
        backgroundColor: pressed ? t.color.bg.sunken : undefined,
      })}
    >
      <View style={{ flexDirection: stacked ? "column" : "row", gap: stacked ? t.space.xxs : t.space.md }}>
        <View style={{ flex: stacked ? undefined : 1, gap: t.space.xxs }}>
          <Text variant="headline" numberOfLines={2}>
            {place.name}
          </Text>
          {(tags || state) && (
            <Text variant="footnote" color="secondary">
              {tags}
              {tags && state ? " · " : ""}
              {state && <Text variant="footnote" color={state.open ? "secondary" : "warning"}>{openStateLabel(state, tr)}</Text>}
            </Text>
          )}
          {!distance && place.address && (
            <Text variant="footnote" color="secondary" numberOfLines={1}>
              {place.address}
            </Text>
          )}
        </View>
        {distance && (
          <Text variant="subhead" numeric align={stacked ? "left" : "right"}>
            {distance}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

function PlaceSheet({
  place,
  now,
  locale,
  onClose,
  onOpenSource,
}: {
  place: Place | null;
  now: Date | null;
  locale: string;
  onClose: () => void;
  onOpenSource: (index: number) => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const toast = useToast();
  if (!place) return <Sheet visible={false} onClose={onClose} title="" />;
  const state = openStateAt(place, now);
  const coords = coordinatesText(place);
  const Row = ({ label, value }: { label: string; value: string }) => (
    <View style={{ gap: t.space.xxs }}>
      <Text variant="label" color="secondary">
        {label}
      </Text>
      <Text selectable>{value}</Text>
    </View>
  );
  return (
    <Sheet
      visible
      onClose={onClose}
      title={place.name}
      description={
        place.distanceM != null ? `${formatDistance(place.distanceM, locale)} · ${sourceName(place.source, tr)}` : sourceName(place.source, tr)
      }
      footer={
        <>
          <Button
            label={tr("chat.places.copyCoordinates")}
            variant="secondary"
            icon="copy"
            fullWidth
            onPress={async () => {
              await Clipboard.setStringAsync(coords);
              toast({ message: tr("chat.places.coordinatesCopied"), icon: "check" });
            }}
          />
          <Button
            label={tr("chat.places.openInMaps")}
            icon="map"
            fullWidth
            onPress={() =>
              Linking.openURL(geoUri(place)).catch(() =>
                toast({
                  message: tr("chat.places.noMapsApp"),
                  tone: "danger",
                  // No maps app (e.g. GrapheneOS): the coordinates still work anywhere.
                  actionLabel: tr("chat.places.copyCoordinates"),
                  onAction: async () => {
                    await Clipboard.setStringAsync(coords);
                    toast({ message: tr("chat.places.coordinatesCopied"), icon: "check" });
                  },
                })
              )
            }
          />
        </>
      }
    >
      <View style={{ gap: t.space.base }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space.xs }}>
          {dietLabels(place.diet, tr, place.dietFlag).map((d) => (
            <Badge key={d} label={d} tone={place.dietFlag === "verify" ? "warning" : "field"} caps={false} />
          ))}
          {cuisineLabels(place.cuisine, 4).map((c) => (
            <Badge key={c} label={c} />
          ))}
        </View>
        {place.address && <Row label={tr("chat.places.address")} value={place.address} />}
        {place.openingHours && (
          <Row
            label={tr("chat.places.hours")}
            value={state ? `${openStateLabel(state, tr)}\n${place.openingHours}` : place.openingHours}
          />
        )}
        {place.phone && <Row label={tr("chat.places.phone")} value={place.phone} />}
        {place.website && <Row label={tr("chat.places.website")} value={place.website} />}
        {place.description && <Row label={tr("chat.places.description")} value={place.description} />}
        <Row label={tr("chat.places.coordinates")} value={coords} />
        {/* The raw id (node/123…) is noise on screen; screen readers still get it for reporting a wrong entry. */}
        <Text variant="caption" color="field" accessibilityLabel={`${sourceName(place.source, tr)}, ${place.id}`}>
          {sourceName(place.source, tr)}
        </Text>
        {place.sourceIndex != null && (
          <Button
            label={tr("chat.places.viewPassage")}
            variant="ghost"
            icon="book"
            style={{ alignSelf: "flex-start" }}
            onPress={() => {
              onClose();
              onOpenSource(place.sourceIndex!);
            }}
          />
        )}
      </View>
    </Sheet>
  );
}

/** "Which city?" when there's no position and no city in the question. */
function CityPrompt({
  locationStatus,
  onCity,
  onUseLocation,
}: {
  locationStatus?: string;
  onCity: (city: string) => void;
  onUseLocation?: () => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [city, setCity] = useState("");
  const submit = () => city.trim() && onCity(city.trim());
  return (
    <Card style={{ gap: t.space.md }}>
      {locationStatus === "denied" && <Banner tone="info" icon="map-pin" message={tr("chat.places.locationDenied")} />}
      {locationStatus === "unavailable" && <Banner tone="info" icon="map-pin" message={tr("chat.places.locationUnavailable")} />}
      <Text variant="headline" header>
        {tr("chat.places.whichCity")}
      </Text>
      <TextField
        label={tr("chat.places.cityLabel")}
        value={city}
        onChangeText={setCity}
        onSubmitEditing={submit}
        returnKeyType="search"
        autoCapitalize="words"
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: t.space.sm }}>
        <Button
          label={tr("chat.places.search")}
          icon="search"
          disabled={!city.trim()}
          accessibilityHint={city.trim() ? undefined : tr("chat.places.searchHint")}
          onPress={submit}
        />
        {onUseLocation && locationStatus !== "denied" && (
          <Button label={tr("chat.places.useLocation")} variant="secondary" icon="navigation" onPress={onUseLocation} />
        )}
      </View>
    </Card>
  );
}

export interface PlacesCardProps {
  answer: AnswerState;
  locale: string;
  onOpenSource: (index: number) => void;
  onCity: (city: string) => void;
  onUseLocation?: () => void;
  onGetMap?: () => void;
}

/**
 * The answer to "vegan restaurants in <city> / near me": the places exactly
 * as recorded in the offline map, one dense row each, ordered by the engine
 * with the ordering stated, attribution once at the bottom. No model writes
 * any of it, so no place can be invented.
 */
export function PlacesCard({ answer, locale, onOpenSource, onCity, onUseLocation, onGetMap }: PlacesCardProps) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [openPlace, setOpenPlace] = useState<Place | null>(null);
  const [showLicense, setShowLicense] = useState(false);
  const clock = useMinuteClock();
  const r = answer.places!;
  // Open/closed needs the place's local time; only a "near" list shares the device's clock.
  const now = deviceClockApplies(r.area) ? clock : null;

  if (r.coverage === "needs_place") {
    return <CityPrompt locationStatus={answer.location?.status} onCity={onCity} onUseLocation={onUseLocation} />;
  }
  const emptyTitle = placesEmptyTitle(r, tr);
  if (r.coverage === "no_pack") {
    return (
      <EmptyState
        icon="map"
        title={emptyTitle!}
        body={tr("chat.places.noPackBody")}
        actionLabel={onGetMap ? tr("chat.places.getMap") : undefined}
        onAction={onGetMap}
      />
    );
  }
  if (emptyTitle) {
    return <EmptyState icon="map" title={emptyTitle} body={tr("chat.places.noneBody")} />;
  }

  const shown = expanded ? r.places : r.places.slice(0, VISIBLE);
  const hidden = r.places.length - shown.length;
  const stale = r.area.origin?.ageS != null && r.area.origin.ageS > 600;

  return (
    <View style={{ gap: t.space.sm }}>
      <Card padding="none" style={{ overflow: "hidden" }}>
        <View style={{ padding: t.space.base, paddingBottom: t.space.sm, gap: t.space.xxs }}>
          <Text variant="label" color="secondary" header numeric>
            {cardTitle(r, r.places.length, tr)}
          </Text>
          <Text variant="footnote" color="secondary">
            {cardSubtitle(r, locale, tr)}
          </Text>
          {stale && (
            <Text variant="caption" color="secondary">
              {tr("chat.places.staleLocation", { minutes: Math.round(r.area.origin!.ageS! / 60) })}
            </Text>
          )}
        </View>
        <View accessibilityRole="list">
          {shown.map((p) => (
            <View key={p.id} style={{ borderTopWidth: t.size.hairline, borderTopColor: t.color.line.hairline }}>
              <PlaceRow place={p} now={now} locale={locale} onPress={() => setOpenPlace(p)} />
            </View>
          ))}
        </View>
        <View
          style={{
            paddingHorizontal: t.space.base,
            paddingVertical: t.space.sm,
            gap: t.space.xs,
            borderTopWidth: t.size.hairline,
            borderTopColor: t.color.line.hairline,
          }}
        >
          {hidden > 0 && (
            <Button
              label={tr("chat.places.showMore", { count: hidden })}
              variant="ghost"
              size="sm"
              style={{ alignSelf: "flex-start", marginLeft: -t.space.md }}
              onPress={() => setExpanded(true)}
            />
          )}
          {r.truncated && expanded && (
            <Text variant="caption" color="secondary">
              {tr("chat.places.truncated")}
            </Text>
          )}
          <Pressable
            onPress={() => setShowLicense((s) => !s)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showLicense }}
            accessibilityLabel={tr("chat.places.attributionLabel")}
            style={{ flexDirection: "row", alignItems: "center", gap: t.space.xs, minHeight: t.size.touch }}
          >
            <Icon name="map" size="sm" color={t.color.text.field} />
            <Text variant="caption" color="field" style={{ flex: 1 }}>
              {r.attribution
                .map((a) => [tr(a.source === "osm" ? "chat.places.creditOsm" : "chat.places.creditWikivoyage"), a.date].filter(Boolean).join(" · "))
                .join(" · ")}
            </Text>
          </Pressable>
          {showLicense && (
            <Text variant="caption" color="secondary">
              {r.attribution
                .map((a) => tr("chat.places.licenseLine", { source: sourceName(a.source, tr), license: a.license }))
                .join("\n")}
            </Text>
          )}
        </View>
      </Card>
      <PlaceSheet place={openPlace} now={now} locale={locale} onClose={() => setOpenPlace(null)} onOpenSource={onOpenSource} />
    </View>
  );
}
