import React, { useEffect, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { getMemoryInfo } from "ram-monitor";
import { listRecentExecutions } from "../../services/executionTelemetry";
import { recordTokPerSec } from "./perfBands";
import { MetaLine } from "../components";
import { useTokens } from "../theme";
import { formatBytes, formatRate } from "./format";
import { modelManager } from "./useCatalog";

/** Refresh rate while the menu is open; nothing is read while it is closed. */
const POLL_MS = 5000;

/**
 * The menu's live line, as the original UI's footer: RAM BOAR uses now, what it stores, and the last
 * answer's speed ("RAM 1.8 GB · Storage 2.3 GB · Last 19 tok/s"). Turned off in Settings.
 */
export function LiveStats({ active }: { active: boolean }) {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const [stats, setStats] = useState<{ rss?: number; storage?: number; rate?: number }>({});

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const poll = async () => {
      let rss: number | undefined;
      try {
        rss = getMemoryInfo().rssBytes || undefined;
      } catch {
        rss = undefined;
      }
      const [storage, records] = await Promise.all([
        modelManager.currentStorageUsageBytes().catch(() => undefined),
        listRecentExecutions(5).catch(() => []),
      ]);
      const last = records.find((r) => r.outcome === "success" && recordTokPerSec(r) !== undefined);
      if (!cancelled) setStats({ rss, storage, rate: last ? recordTokPerSec(last) : undefined });
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

  const lang = i18n.language;
  const items = [
    stats.rss != null && t("nav.liveStats.ram", { size: formatBytes(stats.rss, lang) }),
    stats.storage != null && t("nav.liveStats.storage", { size: formatBytes(stats.storage, lang) }),
    stats.rate != null && t("nav.liveStats.last", { rate: formatRate(stats.rate, lang) }),
  ].filter((x): x is string => !!x);
  if (items.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: tokens.space.base, paddingVertical: tokens.space.sm }}>
      <MetaLine items={items} />
    </View>
  );
}
