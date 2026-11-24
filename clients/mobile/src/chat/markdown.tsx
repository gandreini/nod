import { Fragment, memo, useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { setStringAsync } from 'expo-clipboard';
import { Renderer, useMarkdown } from 'react-native-marked';
import { artifactSource, errorText, request } from '../connection/api';
import type { Connection } from '../connection/connection';
import type { Artifact } from '../connection/contracts';
import { useFileViewer } from '../files/file-viewer-context';
import { imageArtifact, safeLink } from '../connection/links';
import { useNodBase } from '../connection/nod-context';
import { Check, Copy } from '../ui/icons';
import { font, radius, type Theme } from '../ui/theme';

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

function CodeBlock({
  text,
  theme,
  containerStyle,
  textStyle,
}: {
  text: string;
  theme: Theme;
  containerStyle?: ViewStyle;
  textStyle?: TextStyle;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = () =>
    void setStringAsync(text)
      .then(() => setCopied(true))
      .catch((problem: unknown) => Alert.alert('Could not copy the code', errorText(problem)));
  const Icon = copied ? Check : Copy;
  return (
    <View style={containerStyle}>
      <Text selectable style={[textStyle, { paddingLeft: 16, paddingRight: 48 }]}>
        {text}
      </Text>
      <Pressable
        onPress={copy}
        accessibilityRole="button"
        accessibilityLabel={copied ? 'Copied' : 'Copy code'}
        style={({ pressed }) => ({
          position: 'absolute',
          top: 0,
          right: 0,
          width: 44,
          height: 46,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.inset,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon size={16} color={copied ? theme.foreground : theme.mutedForeground} />
      </Pressable>
    </View>
  );
}

class NodRenderer extends Renderer {
  constructor(
    private connection: Connection,
    private theme: Theme,
    private show: (file: Artifact) => void,
  ) {
    super();
  }

  code(text: string, _language?: string, containerStyle?: ViewStyle, textStyle?: TextStyle) {
    return (
      <CodeBlock
        key={this.getKey()}
        text={text}
        theme={this.theme}
        containerStyle={containerStyle}
        textStyle={textStyle}
      />
    );
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
              backgroundColor: this.theme.inset,
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
  const body = { fontFamily: font.regular, fontSize: 17, lineHeight: 25, color: theme.foreground };
  const heading = { fontFamily: font.semibold, color: theme.foreground, letterSpacing: -0.3 };
  return {
    theme: {
      colors: {
        text: theme.foreground,
        link: theme.link,
        code: theme.inset,
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
      h1: { ...heading, fontSize: 26, lineHeight: 34, marginBottom: 8 },
      h2: { ...heading, fontSize: 22, lineHeight: 30, marginBottom: 8 },
      h3: { ...heading, fontSize: 20, lineHeight: 28, marginBottom: 8 },
      h4: { ...heading, fontSize: 17, lineHeight: 25, marginBottom: 8 },
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
        fontSize: 16,
        backgroundColor: theme.inset,
        color: theme.foreground,
      },
      code: {
        backgroundColor: theme.inset,
        borderRadius: radius.control,
        overflow: 'hidden' as const,
        paddingHorizontal: 0,
        paddingVertical: 12,
        marginBottom: 12,
      },
      codeText: {
        fontFamily: font.mono,
        fontStyle: 'normal' as const,
        fontSize: 15,
        lineHeight: 22,
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
  const { connection } = useNodBase();
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
    <View style={{ marginBottom: -12 }}>
      {elements.map((element, index) => (
        <Fragment key={index}>{element}</Fragment>
      ))}
    </View>
  );
});
