import Svg, { Path } from 'react-native-svg';
import {
  iconDrawings,
  type IconDrawing,
  type IconPath,
} from '../../../src/web/components/icon-drawings';

export { Camera, CreditCard, Image, KeyRound, Pause } from 'lucide-react-native';

type Props = { size?: number; color?: string; solid?: boolean; strokeWidth?: number };

function n8n(slug: keyof typeof iconDrawings) {
  const drawing: IconDrawing = iconDrawings[slug];
  return function N8nIcon({ size = 16, color = 'black', solid = false }: Props) {
    const small = size <= 14 ? (solid ? drawing.solid12 : drawing.outline12) : undefined;
    const path: IconPath = small ?? (solid ? drawing.solid16 : drawing.outline16);
    const grid = small ? 12 : 16;
    return (
      <Svg
        width={size}
        height={size}
        viewBox={typeof path === 'string' ? `0 0 ${grid} ${grid}` : path.viewBox}
        fill={color}
        accessible={false}
      >
        <Path d={typeof path === 'string' ? path : path.d} />
      </Svg>
    );
  };
}

export const ArrowUp = n8n('arrow-up');
export const Blocks = n8n('blocks');
export const CalendarClock = n8n('calendar');
export const Check = n8n('check');
export const ChevronDown = n8n('chevron-down');
export const ChevronLeft = n8n('chevron-left');
export const ChevronRight = n8n('chevron-right');
export const Circle = n8n('circle');
export const CircleAlert = n8n('exclamation-circle');
export const CircleCheck = n8n('check-circle');
export const CircleSlash = n8n('slash-circle');
export const Clock = n8n('clock');
export const CodeXml = n8n('brackets-curly');
export const Ellipsis = n8n('dots-horizontal');
export const ExternalLink = n8n('arrow-square-out');
export const Eye = n8n('eyes');
export const FileText = n8n('file-text');
export const Gauge = n8n('gauge');
export const Globe2 = n8n('globe');
export const Hourglass = n8n('hourglass');
export const LayoutGrid = n8n('grid');
export const Link2 = n8n('link');
export const LoaderCircle = n8n('spinner');
export const LogOut = n8n('power');
export const MessageCircle = n8n('chat-bubble');
export const Mic = n8n('microphone');
export const Paperclip = n8n('paperclip');
export const Play = n8n('play');
export const Plus = n8n('plus');
export const RefreshCw = n8n('arrows-cw');
export const ScanSearch = n8n('binoculars');
export const Search = n8n('magnifying-glass');
export const Server = n8n('hard-drive');
export const Settings = n8n('gear');
export const Sparkles = n8n('sparkle');
export const Square = n8n('square');
export const Trash2 = n8n('trash');
export const Undo2 = n8n('arrow-u-up-left');
export const Vault = n8n('vault');
export const X = n8n('x');
export const Zap = n8n('lightning');
