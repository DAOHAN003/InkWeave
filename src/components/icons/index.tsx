/**
 * 图标适配层：lucide-react → @ant-design/icons
 *
 * 目的：把项目图标统一到 Ant Design Icons（MIT），同时让调用方改动最小——
 * 只需把 import 来源从 'lucide-react' 换成本模块，JSX 不用动。
 *
 * 尺寸兼容：
 *   lucide 用 `className="w-4 h-4"` 控尺寸；antd 图标 svg 默认 1em（跟随 font-size）。
 *   适配层把常见的 w-N/h-N 类或 size 数字 prop 解析成 fontSize 注入 style，
 *   使 `<Plus className="w-4 h-4" />` 仍渲染为 16px。颜色走 currentColor，
 *   text-* 颜色类与 animate-spin 等类原样透传。
 */
import React from 'react';
import type { CSSProperties } from 'react';
import {
  LoadingOutlined, CloseOutlined, CloseCircleOutlined, CheckOutlined, CheckCircleOutlined,
  PlusOutlined, MinusOutlined, MinusCircleOutlined, DeleteOutlined,
  DownOutlined, UpOutlined, LeftOutlined, RightOutlined, DoubleLeftOutlined,
  ArrowDownOutlined, ArrowRightOutlined,
  FileTextOutlined, FileAddOutlined, FolderOutlined, FolderOpenOutlined, FolderAddOutlined,
  FileImageOutlined,
  EditOutlined, CopyOutlined, SwapOutlined, ClearOutlined,
  EyeOutlined, EyeInvisibleOutlined,
  UserOutlined, TeamOutlined, RobotOutlined,
  SettingOutlined, ControlOutlined, FilterOutlined, SearchOutlined,
  SaveOutlined, DownloadOutlined, UploadOutlined,
  UndoOutlined, ReloadOutlined,
  LockOutlined, SafetyOutlined, SafetyCertificateOutlined,
  PlayCircleOutlined, PauseOutlined, StepBackwardOutlined, StepForwardOutlined,
  InfoCircleOutlined, ExclamationCircleOutlined, WarningOutlined,
  BulbOutlined, ThunderboltOutlined, ExperimentOutlined,
  ClockCircleOutlined, HistoryOutlined,
  MenuOutlined, MenuUnfoldOutlined, MenuFoldOutlined, MoreOutlined, EnterOutlined,
  FontSizeOutlined, UnorderedListOutlined, CheckSquareOutlined,
  BoldOutlined, ItalicOutlined, OrderedListOutlined, CommentOutlined, CodeOutlined,
  AppstoreOutlined, LayoutOutlined, FullscreenOutlined, FullscreenExitOutlined, ColumnWidthOutlined,
  GlobalOutlined, EnvironmentOutlined, TranslationOutlined, ApartmentOutlined, BranchesOutlined,
  ApiOutlined, DatabaseOutlined, LineChartOutlined, BarChartOutlined,
  LinkOutlined,
  BookOutlined, ReadOutlined, CameraOutlined, CoffeeOutlined, StarOutlined,
  ClusterOutlined, BgColorsOutlined, MessageOutlined, SendOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import type { AntdIconProps } from '@ant-design/icons/lib/components/AntdIcon';

type AntIconComp = React.ComponentType<AntdIconProps>;

export interface IconProps {
  className?: string;
  size?: number | string;
  style?: CSSProperties;
  onClick?: React.MouseEventHandler<HTMLSpanElement>;
  title?: string;
  [key: string]: any;
}

// 把 className 里的 w-N / h-N（Tailwind 尺寸类）解析成像素 fontSize
const W_TO_PX: Record<string, number> = {
  '3': 12, '3.5': 14, '4': 16, '5': 20, '6': 24, '7': 28, '8': 32, '10': 40, '12': 48,
};
function resolveFontSize(className?: string, size?: number | string): number | string | undefined {
  if (typeof size === 'number') return size;
  if (typeof size === 'string' && size) return size;
  if (className) {
    const m = className.match(/(?:^|\s)w-(\d+(?:\.\d+)?)/);
    if (m && W_TO_PX[m[1]] != null) return W_TO_PX[m[1]];
  }
  return 16; // 贴近项目主流 w-4
}

function makeIcon(AntIcon: AntIconComp, extraSpin = false) {
  const Comp: React.FC<IconProps> = ({ className, size, style, ...rest }) => {
    const fontSize = resolveFontSize(className, size);
    const spin = extraSpin || (className ? /\banimate-spin\b/.test(className) : false);
    return (
      <AntIcon
        className={className}
        spin={spin}
        style={{ fontSize, ...style }}
        {...rest}
      />
    );
  };
  return Comp;
}

// 圆点（antd 无线性空心圆，用 svg 自绘，保持线性风格）
const CircleSvg: React.FC<IconProps> = ({ className, size, style, ...rest }) => {
  const fontSize = resolveFontSize(className, size);
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize, width: '1em', height: '1em', ...style }}
      {...rest}
    >
      <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
      </svg>
    </span>
  );
};

// ===== 95 个与 lucide 同名的导出 =====
export const Activity = makeIcon(LineChartOutlined);
export const AlertCircle = makeIcon(ExclamationCircleOutlined);
export const AlertTriangle = makeIcon(WarningOutlined);
export const MoreVertical = makeIcon(MoreOutlined);
export const Bold = makeIcon(BoldOutlined);
export const Italic = makeIcon(ItalicOutlined);
export const ListOrdered = makeIcon(OrderedListOutlined);
export const Quote = makeIcon(CommentOutlined);
export const Code = makeIcon(CodeOutlined);
export const AlignJustify = makeIcon(MenuOutlined);
export const ArrowDown = makeIcon(ArrowDownOutlined);
export const ArrowRight = makeIcon(ArrowRightOutlined);
export const BarChart2 = makeIcon(BarChartOutlined);
export const Book = makeIcon(BookOutlined);
export const BookOpen = makeIcon(ReadOutlined);
export const Bot = makeIcon(RobotOutlined);
export const Brain = makeIcon(ExperimentOutlined);
export const Camera = makeIcon(CameraOutlined);
export const Check = makeIcon(CheckOutlined);
export const CheckCircle2 = makeIcon(CheckCircleOutlined);
export const ChevronDown = makeIcon(DownOutlined);
export const ChevronLeft = makeIcon(LeftOutlined);
export const ChevronRight = makeIcon(RightOutlined);
export const ChevronUp = makeIcon(UpOutlined);
export const ChevronsLeft = makeIcon(DoubleLeftOutlined);
export const Circle = CircleSvg;
export const Clock = makeIcon(ClockCircleOutlined);
export const Clock3 = makeIcon(ClockCircleOutlined);
export const Coffee = makeIcon(CoffeeOutlined);
export const Copy = makeIcon(CopyOutlined);
export const Cpu = makeIcon(ApiOutlined);
export const Download = makeIcon(DownloadOutlined);
export const Edit2 = makeIcon(EditOutlined);
export const Eraser = makeIcon(ClearOutlined);
export const Eye = makeIcon(EyeOutlined);
export const EyeOff = makeIcon(EyeInvisibleOutlined);
export const FileJson = makeIcon(FileTextOutlined);
export const FileImage = makeIcon(FileImageOutlined);
export const FilePlus = makeIcon(FileAddOutlined);
export const FileText = makeIcon(FileTextOutlined);
export const Filter = makeIcon(FilterOutlined);
export const Folder = makeIcon(FolderOutlined);
export const FolderOpen = makeIcon(FolderOpenOutlined);
export const FolderPlus = makeIcon(FolderAddOutlined);
export const GitBranch = makeIcon(BranchesOutlined);
export const GitCompare = makeIcon(BranchesOutlined);
export const Globe = makeIcon(GlobalOutlined);
export const MapPin = makeIcon(EnvironmentOutlined);
export const HardDrive = makeIcon(DatabaseOutlined);
export const History = makeIcon(HistoryOutlined);
export const Indent = makeIcon(MenuUnfoldOutlined);
export const Info = makeIcon(InfoCircleOutlined);
export const Languages = makeIcon(TranslationOutlined);
export const LayoutGrid = makeIcon(AppstoreOutlined);
export const LayoutTemplate = makeIcon(LayoutOutlined);
export const Lightbulb = makeIcon(BulbOutlined);
export const Link2 = makeIcon(LinkOutlined);
export const Link2Off = makeIcon(LinkOutlined);
export const List = makeIcon(UnorderedListOutlined);
export const ListChecks = makeIcon(CheckSquareOutlined);
export const Loader2 = makeIcon(LoadingOutlined, true);
export const Lock = makeIcon(LockOutlined);
export const Maximize2 = makeIcon(FullscreenOutlined);
export const MessageSquare = makeIcon(MessageOutlined);
export const MessageSquarePlus = makeIcon(MessageOutlined);
export const Minimize2 = makeIcon(FullscreenExitOutlined);
export const Minus = makeIcon(MinusOutlined);
export const MinusCircle = makeIcon(MinusCircleOutlined);
export const MoveHorizontal = makeIcon(ColumnWidthOutlined);
export const Network = makeIcon(ApartmentOutlined);
export const Outdent = makeIcon(MenuFoldOutlined);
export const Palette = makeIcon(BgColorsOutlined);
export const PanelLeft = makeIcon(LayoutOutlined);
export const PanelRight = makeIcon(LayoutOutlined);
export const Pause = makeIcon(PauseOutlined);
export const Volume2 = makeIcon(SoundOutlined);
export const Pencil = makeIcon(EditOutlined);
export const Play = makeIcon(PlayCircleOutlined);
export const Plus = makeIcon(PlusOutlined);
export const RefreshCw = makeIcon(ReloadOutlined);
export const Replace = makeIcon(SwapOutlined);
export const RotateCcw = makeIcon(UndoOutlined);
export const RotateCw = makeIcon(ReloadOutlined);
export const Save = makeIcon(SaveOutlined);
export const ScrollText = makeIcon(FileTextOutlined);
export const Search = makeIcon(SearchOutlined);
export const Send = makeIcon(SendOutlined);
export const Settings = makeIcon(SettingOutlined);
export const Shield = makeIcon(SafetyOutlined);
export const ShieldCheck = makeIcon(SafetyCertificateOutlined);
export const SkipBack = makeIcon(StepBackwardOutlined);
export const SkipForward = makeIcon(StepForwardOutlined);
export const SlidersHorizontal = makeIcon(ControlOutlined);
export const Sparkles = makeIcon(ThunderboltOutlined);
export const Star = makeIcon(StarOutlined);
export const Trash2 = makeIcon(DeleteOutlined);
export const TreePine = makeIcon(ClusterOutlined);
export const Type = makeIcon(FontSizeOutlined);
export const Undo2 = makeIcon(UndoOutlined);
export const Upload = makeIcon(UploadOutlined);
export const User = makeIcon(UserOutlined);
export const UserCircle2 = makeIcon(UserOutlined);
export const Users = makeIcon(TeamOutlined);
export const WrapText = makeIcon(EnterOutlined);
export const Workflow = makeIcon(ApiOutlined);
export const X = makeIcon(CloseOutlined);
export const XCircle = makeIcon(CloseCircleOutlined);
export const Zap = makeIcon(ThunderboltOutlined);
