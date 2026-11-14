import { Fragment, useMemo, type ReactNode } from 'react';
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
import { request } from './api';
import { openArtifact } from './attachment-views';
import type { Connection } from './connection';
import type { Artifact } from './contracts';
import { imageArtifact, safeLink } from './links';
import { useNod } from './nod-context';
import { font, radius, type Theme } from './theme';

const mono = 'GeistMono_400Regular';

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function open(connection: Connection, href: string) {
  const link = safeLink(href, connection.origin);
  if (!link) return;
  const fail = (problem: unknown) => Alert.alert('Could not open the link', describe(problem));
  if (link.kind === 'artifact')
    return void request<Artifact>(connection, `/api/artifacts/${link.id}/metadata`)
      .then((artifact) => openArtifact(connection, artifact))
      .catch(fail);
  void Linking.openURL(link.url).catch(fail);
}

class NodRenderer extends Renderer {
  constructor(
    private connection: Connection,
    private theme: Theme,
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
        onPress={() => open(this.connection, href)}
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
        onPress={() => open(this.connection, file.path)}
        accessibilityRole="imagebutton"
        accessibilityLabel={label}
      >
        <Image
          source={{
            uri: `${this.connection.origin}${file.path}`,
            headers: { Authorization: `Bearer ${this.connection.token}` },
          }}
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

export function Markdown({ text, theme, origin }: { text: string; theme: Theme; origin: string }) {
  const { connection } = useNod();
  const renderer = useMemo(() => new NodRenderer(connection, theme), [connection, theme]);
  const body = { fontFamily: font.regular, fontSize: 16, lineHeight: 24, color: theme.foreground };
  const heading = { fontFamily: font.semibold, color: theme.foreground, letterSpacing: -0.3 };
  const elements = useMarkdown(text, {
    colorScheme: theme.dark ? 'dark' : 'light',
    baseUrl: origin,
    renderer,
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
      em: { fontStyle: 'italic' },
      link: { color: theme.link, textDecorationLine: 'underline', fontStyle: 'normal' },
      h1: { ...heading, fontSize: 24, lineHeight: 32, marginBottom: 8 },
      h2: { ...heading, fontSize: 20, lineHeight: 28, marginBottom: 8 },
      h3: { ...heading, fontSize: 18, lineHeight: 26, marginBottom: 8 },
      h4: { ...heading, fontSize: 16, lineHeight: 24, marginBottom: 8 },
      li: body,
      list: { marginBottom: 12 },
      blockquote: {
        borderLeftWidth: 3,
        borderLeftColor: theme.primary,
        paddingLeft: 12,
        marginBottom: 12,
        backgroundColor: 'transparent',
      },
      codespan: {
        fontFamily: mono,
        fontStyle: 'normal',
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
        fontFamily: mono,
        fontStyle: 'normal',
        fontSize: 13,
        lineHeight: 20,
        color: theme.foreground,
      },
      hr: { backgroundColor: theme.border, height: 1, marginVertical: 16 },
      table: { borderColor: theme.border, borderRadius: radius.control, marginBottom: 12 },
      tableRow: { borderColor: theme.border },
      tableCell: { padding: 8 },
    },
  });
  return (
    <View style={{ paddingRight: 16, marginBottom: -12 }}>
      {elements.map((element, index) => (
        <Fragment key={index}>{element}</Fragment>
      ))}
    </View>
  );
}
