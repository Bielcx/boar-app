import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { DocumentPickerAsset } from "expo-document-picker";
import { useTranslation } from "react-i18next";
import { Button, EmptyState, ListRow, Progress, Screen, Section, Sheet, Skeleton, Text, TextField, useAnnounce, useToast } from "./components";
import { useTokens } from "./theme";
import { CatalogModel, CORPUS_CATALOG } from "../models/manifest";
import {
  deleteCustomCollection,
  exportCollection,
  importDocuments,
  ImportProgress,
  listCustomCollections,
  pickDocuments,
  setCustomCollectionActive,
} from "../services/documentImporter";
import type { CustomCollection } from "../rag/db";
import { onSeedProgress, seedKnowledgeBaseIfEmpty, SeedProgress } from "../rag/seedCorpus";
import { CatalogRow } from "./flows/CatalogRow";
import { useCatalog } from "./flows/useCatalog";
import { formatBytes, formatCount } from "./flows/format";

function importPercent(p: ImportProgress): number | undefined {
  if (p.stage !== "embedding" || !p.chunkCount) return undefined;
  return ((p.chunkIndex ?? 0) + 1) / p.chunkCount;
}

export function KnowledgeScreen() {
  const { t, i18n } = useTranslation();
  const tokens = useTokens();
  const toast = useToast();
  const announce = useAnnounce();
  const catalog = useCatalog();
  const { refresh } = catalog;
  const [collections, setCollections] = useState<CustomCollection[] | null>(null);
  const [seed, setSeed] = useState<SeedProgress | null>(null);
  const [picked, setPicked] = useState<DocumentPickerAsset[] | null>(null);
  const [name, setName] = useState("");
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<CustomCollection | null>(null);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    await refresh();
    setCollections(await listCustomCollections());
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );
  useEffect(() => onSeedProgress((p) => setSeed(p.done >= p.total ? null : p)), []);

  const downloadPack = async (pack: CatalogModel) => {
    await catalog.download(pack);
    if (pack.format !== "sqlite-pack") {
      await seedKnowledgeBaseIfEmpty();
      setSeed(null);
    }
    toast({ message: t("flows.knowledge.packReady", { name: pack.label }), tone: "success" });
  };

  const pick = async () => {
    setImportError(null);
    const files = await pickDocuments();
    // Cancelled picker: back to where we were, no message.
    if (!files || files.length === 0) return;
    setPicked(files);
    setName(files[0].name.replace(/\.[^.]+$/, ""));
  };

  const runImport = async () => {
    if (!picked) return;
    const files = picked;
    const collectionName = name.trim() || files[0].name;
    setPicked(null);
    setImporting({ stage: "reading" });
    try {
      await importDocuments(files, collectionName, setImporting);
      announce(t("flows.knowledge.imported", { name: collectionName }));
      toast({ message: t("flows.knowledge.imported", { name: collectionName }), tone: "success" });
    } catch (e: any) {
      setImportError(e?.message ?? String(e));
      announce(t("flows.knowledge.importFailed"), { assertive: true });
    } finally {
      setImporting(null);
      setCollections(await listCustomCollections());
    }
  };

  const toggle = async (c: CustomCollection, active: boolean) => {
    setCollections((prev) => prev?.map((x) => (x.id === c.id ? { ...x, active } : x)) ?? prev);
    await setCustomCollectionActive(c.id, active);
  };

  const exportOne = async (c: CustomCollection) => {
    setExportingId(c.id);
    try {
      await exportCollection(c);
    } catch (e: any) {
      toast({ message: t("flows.knowledge.exportFailed", { error: e?.message ?? String(e) }), tone: "danger" });
    } finally {
      setExportingId(null);
    }
  };

  if (!catalog.loaded || collections === null) {
    return (
      <Screen>
        <View accessible accessibilityLabel={t("flows.common.loading")} style={{ gap: 12 }}>
          <Skeleton height={20} width="50%" />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      </Screen>
    );
  }

  const importValue = importing ? importPercent(importing) : undefined;

  return (
    <Screen>
      <Text variant="callout" color="secondary">
        {t("flows.knowledge.intro")}
      </Text>

      {seed && (
        <View style={{ gap: tokens.space.xs }}>
          <Text variant="subhead">
            {t("flows.knowledge.indexing", { done: formatCount(seed.done, i18n.language), total: formatCount(seed.total, i18n.language) })}
          </Text>
          <Progress
            label={t("flows.knowledge.indexingLabel")}
            value={seed.done / seed.total}
            valueText={t("flows.knowledge.indexing", { done: formatCount(seed.done, i18n.language), total: formatCount(seed.total, i18n.language) })}
          />
        </View>
      )}

      <Section title={t("flows.knowledge.appCollections")} footer={t("flows.knowledge.appFooter")}>
        <ListRow title={t("flows.knowledge.builtin")} subtitle={t("flows.knowledge.builtinSub")} />
        {CORPUS_CATALOG.map((pack) => (
          <CatalogRow
            key={pack.id}
            model={pack}
            view={catalog.view(pack)}
            onDownload={() => downloadPack(pack)}
            onRemove={() => catalog.remove(pack)}
          />
        ))}
      </Section>

      <Section title={t("flows.knowledge.yourCollections")}>
        {collections.length === 0 && !importing ? (
          <EmptyState
            icon="file-plus"
            title={t("flows.knowledge.emptyTitle")}
            body={t("flows.knowledge.emptyBody")}
            actionLabel={t("flows.knowledge.add")}
            onAction={pick}
          />
        ) : (
          collections.map((c) => (
            <View key={c.id}>
              <ListRow
                title={c.name}
                subtitle={t("flows.knowledge.collectionMeta", {
                  docs: t("flows.knowledge.docs", { count: c.docCount }),
                  chunks: t("flows.knowledge.chunks", { count: c.chunkCount }),
                  size: formatBytes(c.sizeBytes, i18n.language),
                })}
                accessibilityLabel={t("flows.knowledge.useInAnswers", { name: c.name })}
                switch={{ value: c.active, onValueChange: (v) => toggle(c, v) }}
              />
              <View style={{ flexDirection: "row", gap: tokens.space.sm, paddingHorizontal: tokens.space.base, paddingBottom: tokens.space.md }}>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="share"
                  label={t("flows.knowledge.export")}
                  accessibilityLabel={t("flows.knowledge.exportA11y", { name: c.name })}
                  loading={exportingId === c.id}
                  onPress={() => exportOne(c)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  label={t("flows.row.remove")}
                  accessibilityLabel={t("flows.knowledge.removeA11y", { name: c.name })}
                  onPress={() => setToRemove(c)}
                />
              </View>
            </View>
          ))
        )}
      </Section>

      {importing && (
        <View style={{ gap: tokens.space.xs }}>
          <Text variant="subhead">{t(`flows.knowledge.stage.${importing.stage}`, { current: (importing.chunkIndex ?? 0) + 1, total: importing.chunkCount ?? 0 })}</Text>
          <Progress label={t("flows.knowledge.importingLabel")} value={importValue} valueText={importValue != null ? `${Math.round(importValue * 100)}%` : undefined} />
        </View>
      )}

      {importError && (
        <EmptyState
          tone="error"
          title={t("flows.knowledge.importFailed")}
          body={importError}
          actionLabel={t("flows.knowledge.pickAgain")}
          onAction={pick}
        />
      )}

      {(collections.length > 0 || importing) && (
        <Button label={t("flows.knowledge.add")} icon="file-plus" onPress={pick} disabled={!!importing} />
      )}

      <Sheet
        visible={picked !== null}
        onClose={() => setPicked(null)}
        title={t("flows.knowledge.nameTitle")}
        description={t("flows.knowledge.filesPicked", { count: picked?.length ?? 0 })}
        footer={
          <>
            <Button label={t("common.cancel")} variant="secondary" fullWidth onPress={() => setPicked(null)} />
            <Button label={t("flows.knowledge.import")} variant="primary" fullWidth onPress={runImport} />
          </>
        }
      >
        <TextField label={t("flows.knowledge.nameLabel")} value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={runImport} />
      </Sheet>

      <Sheet
        visible={toRemove !== null}
        onClose={() => setToRemove(null)}
        title={t("flows.knowledge.removeTitle", { name: toRemove?.name ?? "" })}
        description={t("flows.knowledge.removeBody", { count: toRemove?.chunkCount ?? 0 })}
        footer={
          <>
            <Button label={t("common.cancel")} variant="secondary" fullWidth onPress={() => setToRemove(null)} />
            <Button
              label={t("flows.row.remove")}
              variant="destructive"
              fullWidth
              onPress={async () => {
                const c = toRemove!;
                setToRemove(null);
                await deleteCustomCollection(c.id);
                setCollections(await listCustomCollections());
                toast({ message: t("flows.row.removed", { name: c.name }), tone: "success" });
              }}
            />
          </>
        }
      />
    </Screen>
  );
}
