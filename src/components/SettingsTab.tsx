'use client';
import { PACE_PRESETS, type Settings } from '../lib/settings';
import { WAKE_PRESETS } from '../lib/voice/wake';
import type { VoiceOption } from '../lib/platform';
import { Icon, Range, Segmented, Switch } from './ui';

const isPreset = (s: Settings, p: Partial<Settings>) => Object.entries(p).every(([k, v]) => s[k as keyof Settings] === v);

export default function SettingsTab({
  s, set, voices, speech, owner, keyMask, onKey, onRemoveKey, adminUrl, onAssist, assistMsg, showAndroidTtsInstall, onOpenTtsInstall, showNativeAudioRoutes, audioDevices, audioDevicesChecked, audioDevicesLoading, onCheckAudioDevices,
}: {
  s: Settings; set(p: Partial<Settings>): void; voices: VoiceOption[]; speech: boolean;
  owner: boolean | null; keyMask: string; onKey(): void; onRemoveKey(): void; adminUrl: string;
  onAssist(on: boolean): Promise<string>; assistMsg: string;
  showAndroidTtsInstall: boolean; onOpenTtsInstall(): void;
  showNativeAudioRoutes: boolean; audioDevices: { inputs: string[]; outputs: string[] } | null; audioDevicesChecked: boolean; audioDevicesLoading: boolean; onCheckAudioDevices(): void;
}) {
  const preset = (['write', 'balanced', 'quick'] as const).find((k) => isPreset(s, PACE_PRESETS[k])) ?? 'custom';
  return (
    <>
      <header className="head"><h1 className="title">Settings</h1></header>

      <div className="section-label">Appearance</div>
      <div className="list glass">
        <label className="item"><span>Theme</span><select value={s.appearance} onChange={(e) => set({ appearance: e.target.value as Settings['appearance'] })}><option value="system">System</option><option value="dark">Dark</option><option value="light">Light</option></select></label>
      </div>

      <div className="section-label">Reading pace</div>
      <div className="glass pad pace-card">
        <Segmented label="Reading pace" value={preset} options={[
          { value: 'write', label: 'Write along' }, { value: 'balanced', label: 'Balanced' }, { value: 'quick', label: 'Quick review' },
        ]} onChange={(k) => k !== 'custom' && set(PACE_PRESETS[k])} />
      </div>
      <details className="glass settings-advanced">
        <summary>Fine-tune reading</summary>
        <div className="settings-inner">
          <Range label="Speech speed" value={s.rate} min={0.1} max={1.2} step={0.05} format={(v) => v.toFixed(2) + '×'} onChange={(rate) => set({ rate })} />
          <Range label="Pause between phrases" value={s.gapS} min={0} max={15} step={0.5} format={(v) => v + ' s'} onChange={(gapS) => set({ gapS })} />
          <Range label="Writing time per word" value={s.pw} min={0} max={2} step={0.25} format={(v) => v + ' s'} onChange={(pw) => set({ pw })} />
          <label className="item"><span>Phrase length</span><select value={s.mode} onChange={(e) => set({ mode: e.target.value as Settings['mode'] })}><option value="sentence">Whole sentence</option><option value="clause">By phrase</option><option value="w5">5 words</option><option value="w3">3 words</option><option value="w2">2 words</option></select></label>
          <div className="item"><span>Repeat phrases</span><Switch label="Repeat phrases" checked={s.twice} onChange={(twice) => set({ twice })} /></div>
          <div className="item"><span>Speak punctuation</span><Switch label="Speak punctuation" checked={s.punct} onChange={(punct) => set({ punct })} /></div>
          <div className="item col"><span>After each phrase</span><Segmented label="After each phrase" value={s.advance} options={[{ value: 'timer', label: 'Timed pause' }, { value: 'tap', label: 'Wait for tap' }]} onChange={(advance) => set({ advance })} /></div>
        </div>
      </details>

      <div className="section-label">Playback</div>
      <div className="list glass">
        <label className="item"><span>Voice</span><select value={s.voice} onChange={(e) => set({ voice: e.target.value })}><option value="">Phone default</option>{voices.map((v) => <option key={v.uri} value={v.uri}>{v.label}</option>)}</select></label>
        <div className="item"><span>Auto-read answers</span><Switch label="Auto-read answers" checked={s.auto} onChange={(auto) => set({ auto })} /></div>
        {showAndroidTtsInstall && <div className="item acts-row"><span>Speech voice</span><button className="btn tinted sm" onClick={onOpenTtsInstall}>Manage voices</button></div>}
      </div>

      <div className="section-label">Voice assistant</div>
      <div className="list glass">
        <div className="item"><span>Voice Ask</span><Switch label="Voice Ask" checked={s.assist} onChange={(on) => void onAssist(on)} /></div>
        {s.assist && <>
          <div className="item"><span>Wake phrase</span><Switch label="Listen for wake phrase" checked={s.wakeListen} onChange={(wakeListen) => set({ wakeListen })} /></div>
          {s.wakeListen && <label className="item"><span>Phrase</span><select value={s.wake} onChange={(e) => set({ wake: e.target.value as Settings['wake'] })}>{Object.entries(WAKE_PRESETS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}<option value="custom">Custom</option></select></label>}
          {s.wakeListen && s.wake === 'custom' && <div className="item col"><input className="field" value={s.wakeCustom} placeholder="Your wake phrase" aria-label="Your wake phrase" maxLength={40} onChange={(e) => set({ wakeCustom: e.target.value })} /></div>}
          <div className="item col"><span>Ask button</span><Segmented<number> label="Ask button" value={s.holdMs} options={[{ value: 0, label: 'Tap' }, { value: 1000, label: 'Hold 1 s' }, { value: 3000, label: 'Hold 3 s' }]} onChange={(holdMs) => set({ holdMs: holdMs as Settings['holdMs'] })} /></div>
          <details className="settings-subdetails"><summary>Headset shortcut</summary><div className="item"><span>Use play/pause to Ask</span><Switch label="Use play/pause to Ask" checked={s.earbudAsk} onChange={(earbudAsk) => set({ earbudAsk })} /></div></details>
        </>}
      </div>
      {assistMsg && <p className="foot warn" role="alert">{assistMsg}</p>}
      {s.assist && <p className="foot compact">Speech recognition is handled by your device's speech service.</p>}

      {showNativeAudioRoutes && <details className="glass settings-advanced"><summary>Audio devices</summary><div className="settings-inner"><div className="item col"><div className="item-line"><span>Devices reported by phone</span><button className="btn tinted sm" onClick={onCheckAudioDevices} disabled={audioDevicesLoading}>{audioDevicesLoading ? 'Checking…' : 'Refresh'}</button></div>{audioDevices && <p className="hint compact"><b>Outputs:</b> {audioDevices.outputs.join(' · ') || 'None'}<br/><b>Inputs:</b> {audioDevices.inputs.join(' · ') || 'None'}</p>}{!audioDevices && audioDevicesChecked && <p className="hint compact">No device information returned.</p>}</div></div></details>}

      <div className="section-label">AI</div>
      <div className="list glass">
        {owner ? <div className="item"><span>Gemini</span><span className="ok"><Icon name="check" size={18} /> Server connected</span></div> : <>
          <div className="item"><span>Gemini key</span><span className={keyMask ? 'val mono-val' : 'val warn-val'}>{keyMask || 'Not set'}</span></div>
          <div className="item acts-row"><button className="btn tinted sm" onClick={onKey}><Icon name="key" size={16} /> {keyMask ? 'Change key' : 'Add key'}</button>{keyMask && <button className="btn danger-ghost sm" onClick={onRemoveKey}>Remove</button>}</div>
        </>}
      </div>

      <div className="section-label">License</div>
      <div className="list glass">
        <div className="item"><span>Status</span><span className="ok"><Icon name="check" size={18} /> {owner ? 'Owner device' : 'Active on this device'}</span></div>
        {owner && <div className="item acts-row"><a className="btn tinted sm" href={adminUrl} target="_blank" rel="noopener noreferrer"><Icon name="external" size={16} /> Admin dashboard</a></div>}
      </div>
      {!speech && <p className="foot warn">Speech output is unavailable here. Use a supported browser or the native app.</p>}
    </>
  );
}
