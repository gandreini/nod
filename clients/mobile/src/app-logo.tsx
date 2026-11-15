import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { parse, SvgAst, type JsxAST } from 'react-native-svg';
import { integrationServiceIds } from '../../../src/shared/integrations';
import { Link2 } from './icons';
import type { Theme } from './theme';

type Logo = { kind: 'svg'; ast: JsxAST } | { kind: 'raster'; uri: string } | null;

const logos = new Map<string, Promise<Logo>>();
const rasterExtension = /\.(png|webp|jpe?g|ico|gif)(\?|$)/i;
const bundled = new Set<string>(integrationServiceIds);

function loadLogo(uri: string): Promise<Logo> {
  let pending = logos.get(uri);
  if (!pending) {
    pending = rasterExtension.test(uri)
      ? Promise.resolve({ kind: 'raster', uri })
      : fetch(uri)
          .then(async (response): Promise<Logo> => {
            if (!response.ok) return null;
            const type = response.headers.get('content-type') ?? '';
            if (type.startsWith('image/') && !type.includes('svg')) return { kind: 'raster', uri };
            const ast = parse(await response.text());
            return ast ? { kind: 'svg', ast } : null;
          })
          .catch(() => null);
    logos.set(uri, pending);
  }
  return pending;
}

export function AppLogo({
  slug,
  logoUrl,
  origin,
  theme,
  size = 24,
}: {
  slug?: string;
  logoUrl?: string;
  origin: string;
  theme: Theme;
  size?: number;
}) {
  const base = slug?.replace(/_mcp$/, '');
  const uri = base && bundled.has(base) ? `${origin}/logos/${base}.svg` : logoUrl;
  const [logo, setLogo] = useState<Logo | undefined>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setLogo(undefined);
    setFailed(false);
    if (uri)
      void loadLogo(uri).then((value) => {
        if (active) setLogo(value);
      });
    return () => {
      active = false;
    };
  }, [uri]);
  if (uri && logo === undefined) return <View style={{ width: size, height: size }} />;
  if (logo?.kind === 'svg')
    return <SvgAst ast={logo.ast} override={{ width: size, height: size }} />;
  if (logo?.kind === 'raster' && !failed)
    return (
      <Image
        source={{ uri: logo.uri }}
        style={{ width: size, height: size }}
        resizeMode="contain"
        onError={() => setFailed(true)}
      />
    );
  return <Link2 size={size} color={theme.mutedForeground} />;
}
