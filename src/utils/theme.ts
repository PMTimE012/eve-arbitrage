import type { BuyMethod, TradeMode } from '../types';

export interface TradeTheme {
  pageBg: string;
  headerBg: string;
  card: string;
  subCard: string;
  input: string;
  stepBadge: string;
  pillActive: string;
  pillInactive: string;
  sectionHead: string;
  tableHead: string;
  expandedRow: string;
  accentIcon: string;
  accentText: string;
}

export function getTradeTheme(
  buyMethod: BuyMethod,
  tradeMode: TradeMode,
  activeTab: 'arbitrage' | 'trending' | 'lp' = 'arbitrage'
): TradeTheme {
  const isNeutralTab = activeTab === 'trending' || activeTab === 'lp';
  const isInstant = !isNeutralTab && tradeMode === 'instant' && buyMethod === 'instant';
  const isBuyer = !isNeutralTab && !isInstant;

  return {
    pageBg: isInstant
      ? 'bg-[#12070b]'
      : isBuyer
      ? 'bg-[#06120e]'
      : 'bg-[#090d16]',
    headerBg: isInstant
      ? 'bg-[#17090e]/90 border-rose-950/80'
      : isBuyer
      ? 'bg-[#081712]/90 border-emerald-950/80'
      : 'bg-[#0d1322]/90 border-slate-800/80',
    card: isInstant
      ? 'bg-[#1a0b11] border-rose-900/45'
      : isBuyer
      ? 'bg-[#0a1b15] border-emerald-900/45'
      : 'bg-[#0e1526] border-slate-800/90',
    subCard: isInstant
      ? 'bg-[#12070b]/85 border-rose-950/75'
      : isBuyer
      ? 'bg-[#06120e]/85 border-emerald-950/75'
      : 'bg-[#090d16]/70 border-slate-800',
    input: isInstant
      ? 'bg-[#12070b] border-rose-900/50 focus:border-rose-600'
      : isBuyer
      ? 'bg-[#06120e] border-emerald-900/50 focus:border-emerald-500'
      : 'bg-[#090d16] border-slate-700/80 focus:border-cyan-500',
    stepBadge: isInstant
      ? 'bg-rose-950/90 border-rose-800/70 text-rose-200'
      : isBuyer
      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
      : 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300',
    pillActive: isInstant
      ? 'bg-rose-950/85 border-rose-700/70 text-rose-200'
      : isBuyer
      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
      : 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300',
    pillInactive: isInstant
      ? 'bg-[#12070b] border-rose-950/60 text-slate-400 hover:text-rose-200'
      : isBuyer
      ? 'bg-[#06120e] border-emerald-950/60 text-slate-400 hover:text-emerald-200'
      : 'bg-[#090d16] border-slate-800 text-slate-400 hover:text-slate-200',
    sectionHead: isInstant
      ? 'bg-[#16090e] border-rose-950/75'
      : isBuyer
      ? 'bg-[#081611] border-emerald-950/75'
      : 'bg-[#0c1221] border-slate-800',
    tableHead: isInstant
      ? 'bg-[#14080d] border-rose-950/75'
      : isBuyer
      ? 'bg-[#07140f] border-emerald-950/75'
      : 'bg-[#0b101d] border-slate-800',
    expandedRow: isInstant
      ? 'bg-[#11060a] border-rose-800/50'
      : isBuyer
      ? 'bg-[#06110d] border-emerald-500/30'
      : 'bg-[#090e1a] border-cyan-500/30',
    accentIcon: isInstant
      ? 'text-rose-400'
      : isBuyer
      ? 'text-emerald-400'
      : 'text-cyan-400',
    accentText: isInstant
      ? 'text-rose-300'
      : isBuyer
      ? 'text-emerald-300'
      : 'text-cyan-300',
  };
}
