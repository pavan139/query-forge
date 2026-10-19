import { Download, Laptop, Moon, RotateCcw, Sun, Upload, Volume2, VolumeX } from 'lucide-react';
import { useRef } from 'react';
import { Page, PageHeader } from '../components/ui.tsx';
import { friendlyDate } from '../lib/dates.ts';
import { toast } from '../lib/events.ts';
import { exportBackup, parseBackup, useStore, type Theme } from '../state/store.ts';

export default function Settings() {
  const profile = useStore((s) => s.profile);
  const setProfile = useStore((s) => s.setProfile);
  const lastBackupAt = useStore((s) => s.lastBackupAt);
  const markBackup = useStore((s) => s.markBackup);
  const importData = useStore((s) => s.importData);
  const resetAll = useStore((s) => s.resetAll);
  const file = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sql-quest-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    markBackup();
    toast('Backup downloaded. Keep it somewhere safe (e.g. cloud drive).', 'success');
  };

  const restore = async (f: File) => {
    try {
      const data = parseBackup(await f.text());
      if (!confirm('Replace your current progress with this backup?')) return;
      importData({ ...data, profile: { ...data.profile, onboarded: true } });
      toast('Progress restored!', 'success');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Page>
      <PageHeader icon="⚙️" title="Settings" />
      <div className="space-y-5">
        <section className="card space-y-4 p-6">
          <h2 className="font-bold">Profile</h2>
          <label className="block">
            <span className="text-sm font-semibold">Your name</span>
            <input value={profile.name} onChange={(e) => setProfile({ name: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 outline-none focus:border-primary" />
          </label>
          <div>
            <span className="text-sm font-semibold">Daily XP goal</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {[30, 50, 80, 120, 200].map((g) => (
                <button key={g} className={`btn btn-sm ${profile.dailyGoal === g ? 'btn-primary' : 'btn-outline'}`} onClick={() => setProfile({ dailyGoal: g })}>
                  {g} XP
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-muted">
            Started on {friendlyDate(profile.startedAt)}. Weekly tests unlock every 7 days and monthly tests every 28 days from this date.
          </div>
        </section>

        <section className="card space-y-4 p-6">
          <h2 className="font-bold">Appearance & sound</h2>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['light', Sun, 'Light'],
                ['dark', Moon, 'Dark'],
                ['system', Laptop, 'Match device'],
              ] as const
            ).map(([t, Icon, label]) => (
              <button key={t} onClick={() => setProfile({ theme: t as Theme })} className={`btn btn-sm ${profile.theme === t ? 'btn-primary' : 'btn-outline'}`}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">Editor text size</span>
            {[12, 14, 16, 18].map((f) => (
              <button key={f} className={`btn btn-sm ${profile.editorFont === f ? 'btn-primary' : 'btn-outline'}`} onClick={() => setProfile({ editorFont: f })}>
                {f}px
              </button>
            ))}
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setProfile({ sound: !profile.sound })}>
            {profile.sound ? <Volume2 size={14} /> : <VolumeX size={14} />} Sound effects: {profile.sound ? 'on' : 'off'}
          </button>
        </section>

        <section className="card space-y-3 p-6">
          <h2 className="font-bold">Backup & restore</h2>
          <p className="text-sm text-muted">
            Your progress is saved automatically in this browser. Download a backup file to keep it safe or to continue on another computer.
            {lastBackupAt ? ` Last backup: ${friendlyDate(lastBackupAt)}.` : ' You have not made a backup yet.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={download}>
              <Download size={16} /> Download backup
            </button>
            <button className="btn btn-outline" onClick={() => file.current?.click()}>
              <Upload size={16} /> Restore from file
            </button>
            <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
          </div>
        </section>

        <section className="card space-y-3 border-danger/30 p-6">
          <h2 className="font-bold text-danger-fg">Start over</h2>
          <p className="text-sm text-muted">Erase all progress on this device. Download a backup first if you might want it back.</p>
          <button
            className="btn btn-outline border-danger/40 text-danger"
            onClick={() => {
              if (confirm('Erase ALL progress? This cannot be undone.') && confirm('Really erase everything?')) {
                resetAll();
                location.hash = '#/';
              }
            }}
          >
            <RotateCcw size={16} /> Reset all progress
          </button>
        </section>

        <p className="text-center text-xs text-muted">SQL Quest · runs PostgreSQL 18 (PGlite) entirely in your browser · works offline after the first visit</p>
      </div>
    </Page>
  );
}
