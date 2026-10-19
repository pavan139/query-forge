import { Lock } from 'lucide-react';
import { Page, PageHeader } from '../components/ui.tsx';
import { friendlyDate } from '../lib/dates.ts';
import { ACHIEVEMENTS } from '../state/achievements.ts';
import { useStore } from '../state/store.ts';

const TIER: Record<string, string> = {
  bronze: 'from-amber-700/20 to-amber-500/10 border-amber-600/30',
  silver: 'from-slate-400/25 to-slate-200/10 border-slate-400/40',
  gold: 'from-yellow-400/30 to-amber-200/10 border-yellow-500/40',
  legend: 'from-fuchsia-500/25 to-indigo-500/15 border-fuchsia-500/40',
};

export default function Achievements() {
  const unlocked = useStore((s) => s.achievements);
  const count = Object.keys(unlocked).length;
  return (
    <Page wide>
      <PageHeader icon="🏆" title="Achievements" subtitle={`${count} of ${ACHIEVEMENTS.length} unlocked. Some are easy, some take months — they're all worth it.`} />
      <div className="mb-6 h-3 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full rounded-full bg-accent" style={{ width: `${(count / ACHIEVEMENTS.length) * 100}%` }} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {ACHIEVEMENTS.map((a) => {
          const at = unlocked[a.id];
          return (
            <div key={a.id} className={`card relative flex flex-col items-center p-4 text-center ${at ? `border bg-gradient-to-br ${TIER[a.tier]}` : 'opacity-60'}`}>
              <div className={`flex h-16 w-16 items-center justify-center rounded-2xl text-4xl ${at ? '' : 'grayscale'}`}>{at ? a.icon : <Lock size={26} className="text-muted" />}</div>
              <div className="mt-2 text-sm font-bold">{a.title}</div>
              <div className="mt-0.5 text-xs text-muted">{a.description}</div>
              <div className="mt-2 text-[10px] font-bold tracking-wider text-muted uppercase">{at ? `Unlocked ${friendlyDate(at)}` : a.tier}</div>
            </div>
          );
        })}
      </div>
    </Page>
  );
}
