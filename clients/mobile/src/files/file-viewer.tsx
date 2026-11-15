import { ChevronLeft, ChevronRight, CodeXml, ExternalLink, Eye, FileText } from '../ui/icons';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, Image, Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { artifactSource, read, unreachable, errorText } from '../connection/api';
import { ownedArtifact } from '../connection/links';
import { openArtifact } from './attachment-views';
import { fileSize } from './attachments';
import type { Connection } from '../connection/connection';
import type { Artifact } from '../connection/contracts';
import { ViewerContext } from './file-viewer-context';
import { conversationFiles, fileType, fileView } from './files';
import { Markdown } from '../chat/markdown';
import { useNod } from '../connection/nod-context';
import { font, radius, useTheme, type Theme } from '../ui/theme';
import { Button, Loading } from '../ui/ui';
import { IconButton, Sheet, SheetTitle, sheetStyles, type CloseSheet } from '../ui/sheet';

const shownCharacters = 200_000;
const bodyPadding = 16;

export function FileViewerProvider({ children }: { children: ReactNode }) {
  const { connection, chat } = useNod();
  const theme = useTheme();
  const [current, setCurrent] = useState<Artifact | null>(null);
  const files = useMemo(() => conversationFiles(chat.messages), [chat.messages]);
  const items = current && !files.some((file) => file.id === current.id) ? [current] : files;
  const open = useCallback((file: Artifact) => {
    if (!ownedArtifact(file.url))
      return Alert.alert(
        `Could not open ${file.name}`,
        `${file.url} is not a Nod file address, so Nod did not send it your token.`,
      );
    Keyboard.dismiss();
    setCurrent(file);
  }, []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <ViewerContext.Provider value={value}>
      {children}
      {current ? (
        <FileSheet
          items={items}
          current={current}
          connection={connection}
          theme={theme}
          onSelect={setCurrent}
          onClose={() => setCurrent(null)}
        />
      ) : null}
    </ViewerContext.Provider>
  );
}

async function loadText(connection: Connection, file: Artifact) {
  const source = artifactSource(connection, file.url);
  let response: Response;
  try {
    response = await fetch(source.uri, { headers: source.headers });
  } catch (problem) {
    throw unreachable(connection, problem);
  }
  if (!response.ok) await read(response);
  return response.text();
}

function FileSheet({
  items,
  current,
  connection,
  theme,
  onSelect,
  onClose,
}: {
  items: Artifact[];
  current: Artifact;
  connection: Connection;
  theme: Theme;
  onSelect(file: Artifact): void;
  onClose(): void;
}) {
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const texts = useRef(new Map<string, string>());
  const index = items.findIndex((item) => item.id === current.id);
  const view = fileView(current);

  useEffect(() => {
    setMode('preview');
  }, [current.id]);

  function openOutside(close: CloseSheet) {
    const file = current;
    close(() =>
      openArtifact(connection, file).catch((problem) =>
        Alert.alert(`Could not open ${file.name}`, errorText(problem)),
      ),
    );
  }

  const meta = [fileType(current.name), fileSize(current.size)].join(' · ');

  return (
    <Sheet
      theme={theme}
      handleTestID="file-sheet-handle"
      onClose={onClose}
      header={(close) => (
        <>
          <SheetTitle
            icon={FileText}
            title={current.name}
            meta={meta}
            closeLabel="Close the file"
            theme={theme}
            onClose={() => close()}
          />
          <View style={sheetStyles.toolbar}>
            {view === 'markdown' ? (
              <View
                style={[styles.segmented, { backgroundColor: theme.muted }]}
                accessibilityRole="radiogroup"
              >
                <IconButton
                  icon={Eye}
                  label="Formatted"
                  theme={theme}
                  selected={mode === 'preview'}
                  onPress={() => setMode('preview')}
                />
                <IconButton
                  icon={CodeXml}
                  label="Source"
                  theme={theme}
                  selected={mode === 'source'}
                  onPress={() => setMode('source')}
                />
              </View>
            ) : null}
            <View style={styles.fill} />
            {items.length > 1 ? (
              <View style={styles.nav}>
                <IconButton
                  icon={ChevronLeft}
                  label="Previous file"
                  theme={theme}
                  disabled={index <= 0}
                  onPress={() => onSelect(items[index - 1])}
                />
                <Text
                  style={[styles.count, { color: theme.mutedForeground }]}
                  accessibilityLiveRegion="polite"
                >
                  {index + 1} / {items.length}
                </Text>
                <IconButton
                  icon={ChevronRight}
                  label="Next file"
                  theme={theme}
                  disabled={index >= items.length - 1}
                  onPress={() => onSelect(items[index + 1])}
                />
              </View>
            ) : null}
            <IconButton
              icon={ExternalLink}
              label="Open in another app"
              theme={theme}
              onPress={() => openOutside(close)}
            />
          </View>
        </>
      )}
    >
      {(close) => (
        <FileBody
          key={current.id}
          file={current}
          view={view}
          mode={mode}
          connection={connection}
          theme={theme}
          texts={texts.current}
          bottom={insets.bottom + 24}
          onOpen={() => openOutside(close)}
        />
      )}
    </Sheet>
  );
}

function FileBody({
  file,
  view,
  mode,
  connection,
  theme,
  texts,
  bottom,
  onOpen,
}: {
  file: Artifact;
  view: ReturnType<typeof fileView>;
  mode: 'preview' | 'source';
  connection: Connection;
  theme: Theme;
  texts: Map<string, string>;
  bottom: number;
  onOpen(): void;
}) {
  const needsText = view === 'markdown' || view === 'text';
  const [text, setText] = useState(() => texts.get(file.id));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState(0);

  useEffect(() => {
    if (!needsText || texts.has(file.id)) return;
    let live = true;
    setError('');
    loadText(connection, file)
      .then((value) => {
        texts.set(file.id, value);
        if (live) setText(value);
      })
      .catch((problem) => {
        if (live) setError(`Could not load ${file.name}: ${errorText(problem)}`);
      });
    return () => {
      live = false;
    };
  }, [attempt, connection, file, needsText, texts]);

  const padding = { paddingBottom: bottom };
  if (view === 'outside')
    return (
      <View style={[styles.outside, padding]}>
        <View style={[styles.outsideGlyph, { backgroundColor: theme.muted }]}>
          <FileText size={28} color={theme.secondary} />
        </View>
        <Text style={[styles.outsideTitle, { color: theme.foreground }]}>
          No preview on the phone
        </Text>
        <Text style={[styles.outsideText, { color: theme.mutedForeground }]}>
          Open {fileType(file.name)} files in another app.
        </Text>
        <Button
          label="Open in another app"
          icon={ExternalLink}
          variant="primary"
          onPress={onOpen}
        />
      </View>
    );
  if (error)
    return (
      <View style={[styles.outside, padding]}>
        <Text style={[styles.outsideText, { color: theme.error }]}>{error}</Text>
        <Button
          label="Try again"
          onPress={() => {
            setError('');
            setAttempt((value) => value + 1);
          }}
        />
      </View>
    );
  if (view === 'image')
    return (
      <ScrollView
        contentContainerStyle={[styles.body, padding]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width - bodyPadding * 2)}
      >
        {width > 0 ? (
          <Image
            key={attempt}
            source={artifactSource(connection, file.url)}
            accessibilityLabel={file.name}
            resizeMode="contain"
            onLoad={(event) => {
              const { width: w, height: h } = event.nativeEvent.source;
              if (w && h) setRatio(w / h);
            }}
            onError={(event) => setError(`Could not load ${file.name}: ${event.nativeEvent.error}`)}
            style={{
              width,
              height: ratio ? width / ratio : width,
              borderRadius: radius.input,
              backgroundColor: theme.muted,
            }}
          />
        ) : null}
      </ScrollView>
    );
  if (text === undefined)
    return (
      <View style={[styles.loading, { paddingBottom: bottom }]}>
        <Loading />
      </View>
    );
  const cut = text.length > shownCharacters;
  const shown = cut ? text.slice(0, shownCharacters) : text;
  return (
    <ScrollView contentContainerStyle={[styles.body, padding]}>
      {view === 'markdown' && mode === 'preview' ? (
        <Markdown text={shown} theme={theme} />
      ) : (
        <Text selectable style={[styles.code, { color: theme.foreground }]}>
          {shown}
        </Text>
      )}
      {cut ? (
        <Text style={[styles.outsideText, { color: theme.mutedForeground, marginTop: 16 }]}>
          This shows the first part. Open it in another app to read the rest.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  segmented: { flexDirection: 'row', borderRadius: radius.input, padding: 2, gap: 2 },
  nav: { flexDirection: 'row', alignItems: 'center' },
  count: { fontFamily: font.medium, fontSize: 13, minWidth: 40, textAlign: 'center' },
  body: { padding: bodyPadding },
  code: { fontFamily: font.mono, fontSize: 13, lineHeight: 20 },
  loading: { flex: 1 },
  outside: { alignItems: 'center', gap: 12, paddingHorizontal: 32, paddingTop: 48 },
  outsideGlyph: {
    width: 64,
    height: 64,
    borderRadius: radius.card + 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outsideTitle: { fontFamily: font.semibold, fontSize: 16, lineHeight: 22 },
  outsideText: { fontFamily: font.regular, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
