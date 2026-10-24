'use client';
import { PRESETS, type Settings } from '../lib/settings';
import type { VoiceOption } from '../lib/platform';
import type { Updater } from '../hooks/useUpdater';
import { installedVersion } from '../services/update-service';
import { Icon, Range, Segmented, Switch } from './ui';

const same = (s: Settings, p: Partial<Settings>) => (Object.keys(p) as (keyof Settings)[]).every((k) => s[k] === p[k]);

export default function SettingsTab({
  s, set, voices, speech, owner, keyMask, onKey, onRemoveKey, adminUrl, updater,
}: {
  s: Settings; set(p: Partial<Settings>): void; voices: VoiceOption[]; speech: boolean;
  owner: boolean | null; keyMask: string; onKey(): void; onRemoveKey(): void; adminUrl: string; updater: Updater;
}) {
  const { manual } = updater.snap;
  const preset = (['notes', 'careful', 'normal'] as const).find((k) => same(s, PRESETS[k])) ?? 'custom';
  return (
    <>
      <header className="head"><h1 className="title">Settings</h1></header>

      <div className="section-label">Reading style</div>
      <div className="glass pad">
        <Segmented label="Preset" value={preset}
          options={[{ value: 'notes', label: 'Notes' }, { value: 'careful', label: 'Careful' }, { value: 'normal', label: 'Normal' }]}
          onChange={(k) => k !== 'custom' && set(PRESETS[k])} />
      </div>

      <div className="section-label">Pace</div>
      <div className="list glass">
        <Range label="Speed" value={s.rate} min={0.1} max={1.2} step={0.05} format={(v) => v.toFixed(2) + '×'} onChange={(rate) => set({ rate })} />
        <Range label="Pause between phrases" value={s.gapS} min={0} max={15} step={0.5} format={(v) => v + ' s'} onChange={(gapS) => set({ gapS })} />
        <Range label="Extra writing time per word" value={s.pw} min={0} max={2} step={0.25} format={(v) => v + ' s'} onChange={(pw) => set({ pw })} />
      </div>

      <div className="section-label">Phrases</div>
      <div className="list glass">
        <label className="item">
          <span>Phrase size</span>
          <select value={s.mode} onChange={(e) => set({ mode: e.target.value as Settings['mode'] })}>
            <option value="sentence">Whole sentence</option>
            <option value="clause">Up to each comma</option>
            <option value="w5">5 words</option>
            <option value="w3">3 words</option>
            <option value="w2">2 words</option>
          </select>
        </label>
        <div className="item col">
          <span>After each phrase</span>
          <Segmented label="After each phrase" value={s.advance}
            options={[{ value: 'timer', label: 'Pause timer' }, { value: 'tap', label: 'Wait for my tap' }]}
            onChange={(advance) => set({ advance })} />
        </div>
        <div className="item"><span>Read each phrase twice</span><Switch label="Read each phrase twice" checked={s.twice} onChange={(twice) => set({ twice })} /></div>
        <div className="item"><span>Say punctuation aloud</span><Switch label="Say punctuation aloud" checked={s.punct} onChange={(punct) => set({ punct })} /></div>
      </div>

      <div className="section-label">Starting</div>
      <div className="list glass">
        <div className="item col">
          <span>Start countdown</span>
          <Segmented<number> label="Start countdown" value={s.lead}
            options={[{ value: 0, label: 'None' }, { value: 3, label: '3 s' }, { value: 5, label: '5 s' }]}
            onChange={(lead) => set({ lead: lead as Settings['lead'] })} />
        </div>
        <label className="item">
          <span>Voice</span>
          <select value={s.voice} onChange={(e) => set({ voice: e.target.value })}>
            <option value="">Phone default</option>
            {voices.map((v) => <option key={v.uri} value={v.uri}>{v.label}</option>)}
          </select>
        </label>
        <div className="item"><span>Read as soon as answers are ready</span><Switch label="Read as soon as answers are ready" checked={s.auto} onChange={(auto) => set({ auto })} /></div>
      </div>

      <div className="section-label">AI</div>
      <div className="list glass">
        {owner ? (
          <div className="item"><span>Gemini</span><span className="ok"><Icon name="check" size={18} /> Exam Mate server key</span></div>
        ) : (
          <>
            <div className="item">
              <span>Your Gemini key</span>
              <span className={keyMask ? 'val mono-val' : 'val warn-val'}>{keyMask || 'Not set'}</span>
            </div>
            <div className="item acts-row">
              <button className="btn tinted sm" onClick={onKey}><Icon name="key" size={16} /> {keyMask ? 'Change key' : 'Add key'}</button>
              {keyMask && <button className="btn danger-ghost sm" onClick={onRemoveKey}>Remove</button>}
            </div>
          </>
        )}
      </div>

      <div className="section-label">License</div>
      <div className="list glass">
        <div className="item"><span>Status</span><span className="ok"><Icon name="check" size={18} /> {owner ? 'Owner device' : 'Active on this device'}</span></div>
        {owner && (
          <div className="item acts-row">
            <a className="btn tinted sm" href={adminUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={16} /> Open admin dashboard</a>
          </div>
        )}
      </div>
      {updater.supported && (
        <>
          <div className="section-label">About</div>
          <div className="list glass">
            <div className="item"><span>Version</span><span className="val">{installedVersion()}</span></div>
            <div className="item acts-row">
              <button className="btn tinted sm" disabled={manual === 'checking'} onClick={() => void updater.checkNow()}>
                <Icon name="download" size={16} /> {manual === 'checking' ? 'Checking…' : 'Check for updates'}
              </button>
              <span className={'upd-status' + (manual === 'failed' ? ' warn' : '')} role="status" aria-live="polite">
                {manual === 'current' && 'You have the latest version.'}
                {manual === 'failed' && "Couldn't check. Connect to the internet and try again."}
              </span>
            </div>
          </div>
        </>
      )}
      {!speech && <p className="foot warn">This device has no speech support, so reading aloud will not work.</p>}
      <p className="foot">Earbuds: tap once to pause or resume. Next skips a phrase. Previous repeats it; press twice to go back one.</p>
    </>
  );
}
