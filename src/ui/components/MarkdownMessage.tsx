import React, { memo, useMemo } from "react";
import { View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { IconButton, Text, useToast } from ".";
import { useTokens } from "../theme";
import { parseMarkdown, sameBlock, type Block, type Inline } from "../chat/markdown";

interface Props {
  content: string;
  /** Titles of the answer's sources: "[n]" becomes a link to sources[n - 1]. */
  sourceTitles?: string[];
  onCitationPress?: (n: number) => void;
  isStreaming?: boolean;
}

function Inlines({
  inlines,
  sourceTitles,
  onCitationPress,
}: {
  inlines: Inline[];
  sourceTitles: string[];
  onCitationPress?: (n: number) => void;
}) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  return (
    <>
      {inlines.map((part, i) => {
        switch (part.type) {
          case "bold":
            return (
              <Text key={i} weight="semibold">
                {part.text}
              </Text>
            );
          case "italic":
            return (
              <Text key={i} style={{ fontStyle: "italic" }}>
                {part.text}
              </Text>
            );
          case "code":
            return (
              <Text key={i} variant="mono" style={{ backgroundColor: t.color.bg.sunken }}>
                {part.text}
              </Text>
            );
          case "cite":
            // A nested Text link, not a chip: hitSlop doesn't apply inside text and
            // adjacent markers would overlap. The source strip is the large target.
            return (
              <Text
                key={i}
                color="field"
                weight="semibold"
                numeric
                onPress={onCitationPress ? () => onCitationPress(part.n) : undefined}
                accessibilityRole="link"
                accessibilityLabel={tr("chat.sources.cite", { n: part.n, title: sourceTitles[part.n - 1] ?? "" })}
                maxFontSizeMultiplier={1.5}
              >
                {`[${part.n}]`}
              </Text>
            );
          default:
            return part.text;
        }
      })}
    </>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const t = useTokens();
  const { t: tr } = useTranslation();
  const toast = useToast();
  return (
    <View style={{ backgroundColor: t.color.bg.sunken, borderRadius: t.radius.md, overflow: "hidden" }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingLeft: t.space.md,
          borderBottomWidth: t.size.hairline,
          borderBottomColor: t.color.line.hairline,
        }}
      >
        <Text variant="caption" color="tertiary">
          {language || "code"}
        </Text>
        <IconButton
          icon="copy"
          size="sm"
          label={tr("chat.actions.copy")}
          onPress={async () => {
            await Clipboard.setStringAsync(code);
            toast({ message: tr("chat.actions.copied") });
          }}
        />
      </View>
      <Text variant="mono" selectable style={{ padding: t.space.md }}>
        {code}
      </Text>
    </View>
  );
}

/** The mockup's streaming cursor: a 9x17 ember bar right after the last word ("…treatment▌"), hidden from screen readers. */
function Caret() {
  const t = useTokens();
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ width: t.space.sm + 1, height: t.space.base + 1, borderRadius: t.space.xxs, marginLeft: t.space.xxs, backgroundColor: t.color.accent.solid }}
    />
  );
}

interface BlockProps {
  block: Block;
  sourceTitles: string[];
  onCitationPress?: (n: number) => void;
  /** Streaming cursor drawn inline at the end of this block's text (the last block). */
  caret?: boolean;
}

const sameTitles = (a: string[], b: string[]) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

function BlockContent({ block, sourceTitles, onCitationPress, caret: withCaret }: BlockProps) {
  const t = useTokens();
  const caret = withCaret ? <Caret /> : null;
  const inl = (inlines: Inline[]) => (
    <Inlines inlines={inlines} sourceTitles={sourceTitles} onCitationPress={onCitationPress} />
  );
  switch (block.type) {
    case "heading":
      return (
        <Text variant={block.level === 1 ? "title3" : "headline"} header style={{ marginTop: t.space.xs }}>
          {inl(block.inlines)}
          {caret}
        </Text>
      );
    case "paragraph":
      return (
        <Text selectable>
          {inl(block.inlines)}
          {caret}
        </Text>
      );
    case "bullet":
    case "ordered":
      return (
        <View style={{ flexDirection: "row", gap: t.space.sm, paddingLeft: t.space.xs }}>
          <Text color="secondary" numeric importantForAccessibility="no">
            {block.type === "bullet" ? "•" : `${block.n}.`}
          </Text>
          <Text selectable style={{ flex: 1 }}>
            {inl(block.inlines)}
            {caret}
          </Text>
        </View>
      );
    case "code":
      return <CodeBlock language={block.language} code={block.text} />;
    case "table":
      return (
        <View style={{ gap: t.space.sm }}>
          {block.rows.map((row, r) => (
            <View
              key={r}
              style={{ gap: t.space.xxs, paddingLeft: t.space.md, borderLeftWidth: 2, borderLeftColor: t.color.line.hairline }}
            >
              {row.map((cell, c) => (
                <Text key={c} selectable>
                  <Text weight="semibold">{`${cell.header}: `}</Text>
                  {inl(cell.cells)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

/**
 * Memoized by content: while an answer streams, parseMarkdown hands back new objects every frame, but only
 * the block being written changed; the ones above it (and their native text) stay as they are.
 */
const BlockView = memo(
  BlockContent,
  (a: BlockProps, b: BlockProps) =>
    a.caret === b.caret && a.onCitationPress === b.onCitationPress && sameTitles(a.sourceTitles, b.sourceTitles) && sameBlock(a.block, b.block)
);

const NO_TITLES: string[] = [];

/** Renders an answer's Markdown with design-system type; "[n]" citations open the source. */
export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  sourceTitles = NO_TITLES,
  onCitationPress,
  isStreaming,
}: Props) {
  const t = useTokens();
  const blocks = useMemo(() => parseMarkdown(content, sourceTitles.length), [content, sourceTitles.length]);
  // The cursor sits inside the last text block (readers hear stage changes, never tokens).
  const last = blocks[blocks.length - 1];
  const inlineCaret = !!isStreaming && !!last && last.type !== "code" && last.type !== "table";
  return (
    <View style={{ gap: t.space.sm }}>
      {blocks.map((block, i) => (
        <BlockView
          key={i}
          block={block}
          sourceTitles={sourceTitles}
          onCitationPress={onCitationPress}
          caret={inlineCaret && i === blocks.length - 1}
        />
      ))}
      {/* Nothing streamed yet, or the last block is code/table: the cursor on its own line. */}
      {isStreaming && !inlineCaret && <Caret />}
    </View>
  );
});
