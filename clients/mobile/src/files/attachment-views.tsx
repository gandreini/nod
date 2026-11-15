import { File } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';
import { Camera, FileText, Image as ImageIcon, Paperclip, RefreshCw, X } from '../ui/icons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { artifactSource, request, errorText } from '../connection/api';
import { fileSize, isImage, type AttachSource, type Draft } from './attachments';
import { downloadsFolder } from './downloads';
import { useFileViewer } from './file-viewer-context';
import { fileType } from './files';
import { ownedArtifact } from '../connection/links';
import type { LocalFile } from '../chat/chat-state';
import type { Connection } from '../connection/connection';
import type { Artifact } from '../connection/contracts';
import { font, radius, type Theme } from '../ui/theme';
import type { Icon } from '../ui/ui';

const scriptable =
  /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml)(;|$)|\.(html?|xhtml|svg|xml)$/i;

async function show(file: File, mimeType: string) {
  if (scriptable.test(mimeType) || scriptable.test(file.uri))
    return shareAsync(file.uri, { mimeType: 'text/plain', UTI: 'public.plain-text' });
  if (await File.canPreview(file)) return File.preview(file);
  await shareAsync(file.uri, { mimeType });
}

async function download(connection: Connection, artifact: Artifact) {
  const source = artifactSource(connection, artifact.url);
  try {
    return await File.downloadFileAsync(source.uri, downloadsFolder(), {
      headers: source.headers,
      idempotent: true,
    });
  } catch (problem) {
    await request(connection, `${artifact.url}/metadata`);
    throw problem;
  }
}

export async function openArtifact(connection: Connection, artifact: Artifact) {
  await show(await download(connection, artifact), artifact.mimeType);
}

export function openLocal(file: LocalFile) {
  return show(new File(file.uri), file.mimeType);
}

function openFailed(name: string) {
  return (problem: unknown) => Alert.alert(`Could not open ${name}`, errorText(problem));
}

const sources: Array<{ key: AttachSource; icon: Icon; label: string }> = [
  { key: 'camera', icon: Camera, label: 'Camera' },
  { key: 'photos', icon: ImageIcon, label: 'Photos' },
  { key: 'files', icon: FileText, label: 'Files' },
];

export function AttachMenu({
  visible,
  theme,
  above,
  onClose,
  onPick,
}: {
  visible: boolean;
  theme: Theme;
  above: number;
  onClose(): void;
  onPick(source: AttachSource): void;
}) {
  const picked = useRef<AttachSource | null>(null);
  function dismissed() {
    const source = picked.current;
    picked.current = null;
    if (source) onPick(source);
  }
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={dismissed}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} />
        <View
          accessibilityViewIsModal
          onAccessibilityEscape={onClose}
          style={[
            styles.menu,
            {
              bottom: above,
              backgroundColor: theme.surface,
              borderColor: theme.hairline,
              boxShadow: theme.shadow.raised,
            },
          ]}
        >
          {sources.map(({ key, icon: SourceIcon, label }, index) => (
            <Pressable
              key={key}
              onPress={() => {
                onClose();
                if (Platform.OS === 'ios') picked.current = key;
                else onPick(key);
              }}
              accessibilityRole="menuitem"
              style={({ pressed }) => [
                styles.menuItem,
                {
                  backgroundColor: pressed ? theme.controlActive : 'transparent',
                  borderTopColor: theme.border,
                  borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <SourceIcon size={20} color={theme.secondary} />
              <Text style={[styles.menuLabel, { color: theme.foreground }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

export function DraftStrip({
  drafts,
  theme,
  onRemove,
  onRetry,
}: {
  drafts: Draft[];
  theme: Theme;
  onRemove(id: string): void;
  onRetry(id: string): void;
}) {
  if (!drafts.length) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
      keyboardShouldPersistTaps="handled"
    >
      {drafts.map((draft) => {
        const failed = draft.state === 'failed';
        const image = isImage(draft.mimeType);
        return (
          <View key={draft.id} style={styles.draftWrap}>
            <Pressable
              onPress={
                failed
                  ? () => onRetry(draft.id)
                  : () => void openLocal(draft).catch(openFailed(draft.name))
              }
              accessibilityRole="button"
              accessibilityLabel={failed ? `Retry ${draft.name}: ${draft.error}` : draft.name}
              style={[
                image ? styles.draftImage : styles.draftFile,
                {
                  backgroundColor: theme.muted,
                  borderColor: failed ? theme.error : 'transparent',
                },
              ]}
            >
              {image ? (
                <Image source={{ uri: draft.uri }} style={styles.fillImage} />
              ) : (
                <View style={styles.draftFileBody}>
                  <FileText size={20} color={theme.secondary} />
                  <View style={styles.fill}>
                    <Text numberOfLines={1} style={[styles.fileName, { color: theme.foreground }]}>
                      {draft.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.fileMeta,
                        { color: failed ? theme.error : theme.mutedForeground },
                      ]}
                    >
                      {failed
                        ? 'Upload failed · tap to retry'
                        : draft.size !== undefined
                          ? fileSize(draft.size)
                          : ''}
                    </Text>
                  </View>
                </View>
              )}
              {draft.state === 'uploading' ? (
                <View
                  style={[
                    styles.overlay,
                    { backgroundColor: theme.dark ? 'rgba(0,0,0,0.45)' : 'rgba(250,250,250,0.6)' },
                  ]}
                >
                  <ActivityIndicator size="small" color={theme.accent} />
                </View>
              ) : null}
              {failed && image ? (
                <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.35)' }]}>
                  <RefreshCw size={20} color="#fafafa" />
                </View>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => onRemove(draft.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${draft.name}`}
              style={[
                styles.remove,
                { backgroundColor: theme.foreground, borderColor: theme.surface },
              ]}
            >
              <X size={12} color={theme.background} />
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}

function FileChip({
  name,
  meta,
  theme,
  onPress,
}: {
  name: string;
  meta: string;
  theme: Theme;
  onPress(): void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <View style={styles.chipWrap}>
      <Pressable
        onPress={async () => {
          setBusy(true);
          setError(undefined);
          try {
            await onPress();
          } catch (problem) {
            setError(`Could not open ${name}: ${errorText(problem)}`);
          } finally {
            setBusy(false);
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open ${name}`}
        style={({ pressed }) => [
          styles.chip,
          {
            backgroundColor: pressed ? theme.controlActive : theme.surface,
            borderColor: theme.border,
          },
        ]}
      >
        <View style={[styles.chipIcon, { backgroundColor: theme.muted }]}>
          {busy ? (
            <ActivityIndicator size="small" color={theme.accent} />
          ) : (
            <Paperclip size={18} color={theme.secondary} />
          )}
        </View>
        <View style={styles.fill}>
          <Text numberOfLines={1} style={[styles.fileName, { color: theme.foreground }]}>
            {name}
          </Text>
          <Text numberOfLines={1} style={[styles.fileMeta, { color: theme.mutedForeground }]}>
            {meta}
          </Text>
        </View>
      </Pressable>
      {error ? <Text style={[styles.fileMeta, { color: theme.error }]}>{error}</Text> : null}
    </View>
  );
}

export function MessageAttachments({
  attachments,
  local,
  connection,
  theme,
  alignEnd,
}: {
  attachments?: Artifact[];
  local?: LocalFile[];
  connection: Connection;
  theme: Theme;
  alignEnd?: boolean;
}) {
  const viewer = useFileViewer();
  const items = [
    ...(attachments ?? [])
      .filter((artifact) => ownedArtifact(artifact.url))
      .map((artifact) => ({
        key: artifact.id,
        name: artifact.name,
        mimeType: artifact.mimeType,
        size: artifact.size,
        source: artifactSource(connection, artifact.url),
        open: async () => viewer.open(artifact),
      })),
    ...(local ?? []).map((file) => ({
      key: file.uri,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      source: { uri: file.uri },
      open: () => openLocal(file),
    })),
  ];
  if (!items.length) return null;
  const images = items.filter((item) => isImage(item.mimeType));
  const files = items.filter((item) => !isImage(item.mimeType));
  return (
    <View style={[styles.attachments, alignEnd ? styles.end : null]}>
      {images.length ? (
        <View style={[styles.images, alignEnd ? styles.endRow : null]}>
          {images.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => void item.open().catch(openFailed(item.name))}
              accessibilityRole="imagebutton"
              accessibilityLabel={`Open ${item.name}`}
            >
              <Image
                source={item.source}
                style={[
                  images.length === 1 ? styles.single : styles.thumb,
                  { backgroundColor: theme.muted },
                ]}
                resizeMode="cover"
              />
            </Pressable>
          ))}
        </View>
      ) : null}
      {files.map((item) => (
        <FileChip
          key={item.key}
          name={item.name}
          meta={[fileType(item.name), item.size !== undefined ? fileSize(item.size) : undefined]
            .filter(Boolean)
            .join(' · ')}
          theme={theme}
          onPress={item.open}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1 },
  menu: {
    position: 'absolute',
    left: 16,
    minWidth: 200,
    borderRadius: radius.card + 4,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingVertical: 4,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 16,
  },
  menuLabel: { fontFamily: font.medium, fontSize: 16 },
  strip: { gap: 8, paddingTop: 4, paddingBottom: 4, paddingRight: 8 },
  draftWrap: { paddingTop: 6, paddingRight: 6 },
  draftImage: {
    width: 64,
    height: 64,
    borderRadius: radius.input,
    overflow: 'hidden',
    borderWidth: 1.5,
  },
  draftFile: {
    width: 176,
    height: 64,
    borderRadius: radius.input,
    overflow: 'hidden',
    borderWidth: 1.5,
    justifyContent: 'center',
  },
  draftFileBody: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  fillImage: { width: '100%', height: '100%' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileName: { fontFamily: font.medium, fontSize: 13, lineHeight: 18 },
  fileMeta: { fontFamily: font.regular, fontSize: 12, lineHeight: 16 },
  attachments: { gap: 8 },
  end: { alignSelf: 'flex-end', maxWidth: '85%', minWidth: 220 },
  endRow: { justifyContent: 'flex-end' },
  images: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  single: { width: 240, height: 240, borderRadius: radius.bubble },
  thumb: { width: 118, height: 118, borderRadius: radius.input },
  chipWrap: { gap: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    paddingRight: 16,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  chipIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
