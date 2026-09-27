import React, { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, ListRow, Screen, Section, Skeleton, Text, TextField, useToast } from "./components";
import { useTokens } from "./theme";
import { CatalogModel, MODEL_CATALOG } from "../models/manifest";
import { addDiscoveredModel } from "../models/discoveredModels";
import { HFGgufFile, HFModelSummary, listGgufFiles, searchModels, toCatalogModel } from "../services/modelBrowser";
import { CatalogRow } from "./flows/CatalogRow";
import { useCatalog } from "./flows/useCatalog";
import { formatBytes, formatCount } from "./flows/format";
import type { RootStackParamList } from "./navigation/types";

type Nav = NativeStackNavigationProp<RootStackParamList>;

function Hairline() {
  const t = useTokens();
  return <View style={{ height: t.size.hairline, backgroundColor: t.color.line.hairline, marginLeft: t.space.base }} />;
}

export function ModelsScreen() {
  const { t, i18n } = useTranslation();
  const navigation = useNavigation<Nav>();
  const toast = useToast();
  const catalog = useCatalog();
  const { refresh } = catalog;

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  if (!catalog.loaded) {
    return (
      <Screen>
        <View accessible accessibilityLabel={t("flows.common.loading")} style={{ gap: 12 }}>
          <Skeleton height={20} width="60%" />
          <Skeleton height={96} />
          <Skeleton height={96} />
        </View>
      </Screen>
    );
  }

  const models: CatalogModel[] = [
    ...MODEL_CATALOG.filter((m) => m.kind === "llm" || m.kind === "embedding"),
    ...catalog.discovered.filter((d) => !MODEL_CATALOG.some((c) => c.filename === d.filename)),
  ];
  const groups = { inUse: [] as CatalogModel[], installed: [] as CatalogModel[], available: [] as CatalogModel[] };
  for (const m of models) {
    const kind = catalog.view(m).state.kind;
    if (kind === "in-use") groups.inUse.push(m);
    else if (kind === "not-installed" || kind === "downloading" || kind === "verifying" || (kind === "failed" && !catalog.statuses[m.id]?.present))
      groups.available.push(m);
    else groups.installed.push(m);
  }

  const use = async (m: CatalogModel) => {
    const ok = await catalog.use(m);
    if (ok) toast({ message: t("flows.models.nowAnswering", { name: m.label }), tone: "success" });
  };

  const renderGroup = (list: CatalogModel[]) =>
    list.map((m, i) => (
      <React.Fragment key={m.id}>
        {i > 0 && <Hairline />}
        <CatalogRow
          model={m}
          view={catalog.view(m)}
          busy={catalog.loadingId !== null}
          onDownload={() => catalog.download(m)}
          onUse={() => use(m)}
          onRemove={() => catalog.remove(m)}
        />
      </React.Fragment>
    ));

  return (
    <Screen>
      <Text variant="callout" color="secondary">
        {t("flows.models.storage", {
          used: formatBytes(catalog.usedBytes, i18n.language),
          free: catalog.freeBytes > 0 ? formatBytes(catalog.freeBytes, i18n.language) : "—",
        })}
      </Text>

      <Section title={t("flows.models.inUse")} footer={t("flows.models.inUseFooter")}>
        {renderGroup(groups.inUse)}
      </Section>

      {groups.installed.length > 0 && <Section title={t("flows.models.installed")}>{renderGroup(groups.installed)}</Section>}

      <Section title={t("flows.models.available")} footer={t("flows.models.availableFooter")}>
        {groups.available.length > 0 ? (
          renderGroup(groups.available)
        ) : (
          <View style={{ padding: 16 }}>
            <Text variant="callout" color="secondary">
              {t("flows.models.allInstalled")}
            </Text>
          </View>
        )}
      </Section>

      <Section title={t("flows.models.advanced")} footer={t("flows.models.searchFooter")}>
        <ListRow icon="search" title={t("flows.models.searchTitle")} onPress={() => navigation.navigate("ModelSearch")} />
      </Section>
    </Screen>
  );
}

type SearchState =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "error"; message: string }
  | { kind: "results"; items: HFModelSummary[] };

export function ModelSearchScreen() {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });
  const [open, setOpen] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, HFGgufFile[] | "loading" | "error">>({});
  const [adding, setAdding] = useState<string | null>(null);

  const run = async () => {
    const q = query.trim();
    if (!q) return;
    setSearch({ kind: "searching" });
    setOpen(null);
    try {
      setSearch({ kind: "results", items: await searchModels(q) });
    } catch (e: any) {
      setSearch({ kind: "error", message: e?.message ?? String(e) });
    }
  };

  const toggle = async (repoId: string) => {
    if (open === repoId) return setOpen(null);
    setOpen(repoId);
    if (Array.isArray(files[repoId])) return;
    setFiles((f) => ({ ...f, [repoId]: "loading" }));
    try {
      const list = await listGgufFiles(repoId);
      setFiles((f) => ({ ...f, [repoId]: list }));
    } catch {
      setFiles((f) => ({ ...f, [repoId]: "error" }));
    }
  };

  const add = async (repoId: string, file: HFGgufFile) => {
    const key = `${repoId}/${file.filename}`;
    setAdding(key);
    try {
      const model = toCatalogModel(repoId, file);
      await addDiscoveredModel(model);
      toast({ message: t("flows.models.added", { name: model.label }), tone: "success" });
    } catch (e: any) {
      toast({ message: t("flows.models.addFailed", { error: e?.message ?? String(e) }), tone: "danger" });
    } finally {
      setAdding(null);
    }
  };

  return (
    <Screen>
      <Text variant="callout" color="secondary">
        {t("flows.models.searchIntro")}
      </Text>
      <TextField
        accessibilityLabel={t("flows.models.searchTitle")}
        placeholder={t("flows.models.searchPlaceholder")}
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={run}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Button label={t("flows.models.searchButton")} icon="search" onPress={run} loading={search.kind === "searching"} disabled={!query.trim()} />

      {search.kind === "error" && (
        <EmptyState
          tone="error"
          icon="wifi-off"
          title={t("flows.models.searchFailed")}
          body={search.message}
          actionLabel={t("flows.row.retry")}
          onAction={run}
        />
      )}
      {search.kind === "results" && search.items.length === 0 && (
        <EmptyState icon="search" title={t("flows.models.noResults")} body={t("flows.models.noResultsBody")} />
      )}
      {search.kind === "results" && search.items.length > 0 && (
        <Section>
          {search.items.map((item) => {
            const list = files[item.id];
            return (
              <View key={item.id}>
                <ListRow
                  title={item.id}
                  subtitle={t("flows.models.repoMeta", {
                    downloads: formatCount(item.downloads ?? 0, i18n.language),
                    likes: formatCount(item.likes ?? 0, i18n.language),
                  })}
                  onPress={() => toggle(item.id)}
                  accessibilityHint={t("flows.models.repoHint")}
                />
                {open === item.id && (
                  <View style={{ paddingHorizontal: tokens.space.base, paddingBottom: tokens.space.md, gap: tokens.space.sm }}>
                    {list === "loading" && <Skeleton height={40} />}
                    {list === "error" && (
                      <Text variant="footnote" color="danger">
                        {t("flows.models.filesFailed")}
                      </Text>
                    )}
                    {Array.isArray(list) && list.length === 0 && (
                      <Text variant="footnote" color="secondary">
                        {t("flows.models.noGguf")}
                      </Text>
                    )}
                    {Array.isArray(list) &&
                      list.map((file) => {
                        const key = `${item.id}/${file.filename}`;
                        return (
                          <View key={key} style={{ gap: tokens.space.xs }}>
                            <Text variant="callout" numberOfLines={2} ellipsizeMode="middle" accessibilityLabel={file.filename}>
                              {file.filename}
                            </Text>
                            <Text variant="footnote" color={file.sha256 ? "secondary" : "warning"}>
                              {formatBytes(file.sizeBytes, i18n.language)}
                              {file.sha256 ? "" : ` · ${t("flows.models.noChecksum")}`}
                            </Text>
                            <Button size="sm" variant="secondary" label={t("flows.models.addToList")} loading={adding === key} onPress={() => add(item.id, file)} />
                          </View>
                        );
                      })}
                  </View>
                )}
              </View>
            );
          })}
        </Section>
      )}
    </Screen>
  );
}
