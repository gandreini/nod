import { Fragment, memo, useMemo, type ReactNode } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  Text,
  View,
  type ImageStyle,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Renderer, useMarkdown } from 'react-native-marked';
import { artifactSource, errorText, request } from './api';
import type { Connection } from './connection';
import type { Artifact } from './contracts';
import { useFileViewer } from './file-viewer-context';
import { imageArtifact, safeLink } from './links';
import { useNod } from './nod-context';
import { font, radius, type Theme } from './theme';

function open(connection: Connection, href: string, show: (file: Artifact) => void) {
  const link = safeLink(href, connection.origin);
  if (!link) return;
  const fail = (problem: unknown) => Alert.alert('Could not open the link', errorText(problem));
  if (link.kind === 'artifact')
    return void request<Artifact>(connection, `/api/artifacts/${link.id}/metadata`)
      .then(show)
      .catch(fail);
  void Linking.openURL(link.url).catch(fail);
}

class NodRenderer extends Renderer {
  constructor(
    private connection: Connection,
    private theme: Theme,
    private show: (file: Artifact) => void,
  ) {
    super();
  }

  link(
    children: string | ReactNode[],
    href: string,
    styles?: TextStyle,
    title?: string,
  ): ReactNode {
    if (!safeLink(href, this.connection.origin))
      return (
        <Text
          key={this.getKey()}
          style={[styles, { color: this.theme.foreground, textDecorationLine: 'none' }]}
        >
          {children}
        </Text>
      );
    return (
      <Text
        key={this.getKey()}
        accessibilityRole="link"
        accessibilityLabel={title}
        onPress={() => open(this.connection, href, this.show)}
        style={styles}
      >
        {children}
      </Text>
    );
  }

  image(uri: string, alt?: string, style?: ImageStyle, title?: string): ReactNode {
    const label = alt || title || 'Image';
    const file = imageArtifact(uri, this.connection.origin);
    if (!file)
      return (
        <Text
          key={this.getKey()}
          style={{ color: this.theme.mutedForeground, fontStyle: 'italic' }}
        >
          [{label}]
        </Text>
      );
    return (
      <Pressable
        key={this.getKey()}
        onPress={() => open(this.connection, file.path, this.show)}
        accessibilityRole="imagebutton"
        accessibilityLabel={label}
      >
        <Image
          source={artifactSource(this.connection, file.path)}
          resizeMode="cover"
          style={[
            {
              width: 240,
              height: 240,
              borderRadius: radius.bubble,
              backgroundColor: this.theme.muted,
            },
            style,
          ]}
        />
      </Pressable>
    );
  }

  linkImage(
    href: string,
    imageUrl: string,
    alt?: string,
    style?: ImageStyle,
    title?: string,
  ): ReactNode {
    return this.image(imageUrl, alt, style, title);
  }

  list(
    ordered: boolean,
    li: ReactNode[],
    listStyle?: ViewStyle,
    textStyle?: TextStyle,
    startIndex?: number,
  ): ReactNode {
    return (
      <View key={this.getKey()} style={{ gap: 4, marginBottom: 12 }}>
        {super.list(ordered, li, listStyle, textStyle, startIndex)}
      </View>
    );
  }

  table(
    header: ReactNode[][],
    rows: ReactNode[][][],
    tableStyle?: ViewStyle,
    rowStyle?: ViewStyle,
    cellStyle?: ViewStyle,
  ): ReactNode {
    return (
      <View key={this.getKey()} style={{ marginTop: 4, marginBottom: 20 }}>
        {super.table(header, rows, tableStyle, rowStyle, cellStyle)}
      </View>
    );
  }
}

function markdownStyles(theme: Theme) {
  const body = { fontFamily: font.regular, fontSize: 16, lineHeight: 24, color: theme.foreground };
  const heading = { fontFamily: font.semibold, color: theme.foreground, letterSpacing: -0.3 };
  return {
    theme: {
      colors: {
        text: theme.foreground,
        link: theme.link,
        code: theme.muted,
        border: theme.border,
      },
    },
    styles: {
      text: body,
      paragraph: { marginTop: 0, marginBottom: 12, paddingVertical: 0 },
      strong: { fontFamily: font.semibold },
      em: { fontStyle: 'italic' as const },
      link: {
        color: theme.link,
        textDecorationLine: 'underline' as const,
        fontStyle: 'normal' as const,
      },
      h1: { ...heading, fontSize: 24, lineHeight: 32, marginBottom: 8 },
      h2: { ...heading, fontSize: 20, lineHeight: 28, marginBottom: 8 },
      h3: { ...heading, fontSize: 18, lineHeight: 26, marginBottom: 8 },
      h4: { ...heading, fontSize: 16, lineHeight: 24, marginBottom: 8 },
      li: body,
      blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: theme.primary,
        paddingLeft: 12,
        marginBottom: 12,
        backgroundColor: 'transparent',
      },
      codespan: {
        fontFamily: font.mono,
        fontStyle: 'normal' as const,
        fontSize: 14,
        backgroundColor: theme.muted,
        color: theme.foreground,
      },
      code: {
        backgroundColor: theme.muted,
        borderRadius: radius.control,
        padding: 12,
        marginBottom: 12,
      },
      codeText: {
        fontFamily: font.mono,
        fontStyle: 'normal' as const,
        fontSize: 13,
        lineHeight: 20,
        color: theme.foreground,
      },
      hr: { backgroundColor: theme.border, height: 1, marginVertical: 16 },
      table: { borderColor: theme.border, borderRadius: radius.control, marginBottom: 12 },
      tableRow: { borderColor: theme.border },
      tableCell: { padding: 8 },
    },
  };
}

export const Markdown = memo(function Markdown({ text, theme }: { text: string; theme: Theme }) {
  const { connection } = useNod();
  const viewer = useFileViewer();
  const options = useMemo(
    () => ({
      ...markdownStyles(theme),
      colorScheme: theme.dark ? ('dark' as const) : ('light' as const),
      baseUrl: connection.origin,
      renderer: new NodRenderer(connection, theme, viewer.open),
    }),
    [connection, theme, viewer.open],
  );
  const elements = useMarkdown(text, options);
  return (
    <View style={{ paddingRight: 16, marginBottom: -12 }}>
      {elements.map((element, index) => (
        <Fragment key={index}>{element}</Fragment>
      ))}
    </View>
  );
});
