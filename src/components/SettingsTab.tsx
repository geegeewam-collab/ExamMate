'use client';
import { PRESETS, type Settings } from '../lib/settings';
import { WAKE_PRESETS } from '../lib/voice/wake';
import type { VoiceOption } from '../lib/platform';
import { Icon, Range, Segmented, Switch } from './ui';

const same = (s: Settings, p: Partial<Settings>) => (Object.keys(p) as (keyof Settings)[]).every((k) => s[k] === p[k]);

export default function SettingsTab({
  s, set, voices, speech, owner, keyMask, onKey, onRemoveKey, adminUrl, onAssist, assistMsg, showAndroidTtsInstall, onOpenTtsInstall, showNativeAudioRoutes, audioDevices, audioDevicesChecked, audioDevicesLoading, onCheckAudioDevices,
}: {
  s: Settings; set(p: Partial<Settings>): void; voices: VoiceOption[]; speech: boolean;
  owner: boolean | null; keyMask: string; onKey(): void; onRemoveKey(): void; adminUrl: string;
  /** Turns the voice assistant on/off. Resolves with an error message to show, or '' on success. */
  onAssist(on: boolean): Promise<string>;
  assistMsg: string;
  showAndroidTtsInstall: boolean; onOpenTtsInstall(): void;
  showNativeAudioRoutes: boolean; audioDevices: { inputs: string[]; outputs: string[] } | null; audioDevicesChecked: boolean; audioDevicesLoading: boolean; onCheckAudioDevices(): void;
}) {
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
        {showAndroidTtsInstall && <div className="item acts-row"><span>Missing a reading voice?</span><button className="btn tinted sm" onClick={onOpenTtsInstall}>Install / manage voices</button></div>}
      </div>

      <div className="section-label">Voice assistant</div>
      <div className="list glass">
        <div className="item">
          <span>Ask questions by voice</span>
          <Switch label="Ask questions by voice" checked={s.assist} onChange={(on) => void onAssist(on)} />
        </div>
        {s.assist && (
          <>
            <div className="item">
              <span>Listen for the wake phrase</span>
              <Switch label="Listen for the wake phrase" checked={s.wakeListen} onChange={(wakeListen) => set({ wakeListen })} />
            </div>
            {s.wakeListen && (
              <label className="item">
                <span>Wake phrase</span>
                <select value={s.wake} onChange={(e) => set({ wake: e.target.value as Settings['wake'] })}>
                  {Object.entries(WAKE_PRESETS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
                  <option value="custom">Your own phrase</option>
                </select>
              </label>
            )}
            {s.wakeListen && s.wake === 'custom' && (
              <div className="item col">
                <input className="field" value={s.wakeCustom} placeholder="e.g. study buddy" aria-label="Your wake phrase" maxLength={40}
                  onChange={(e) => set({ wakeCustom: e.target.value })} />
                <span className="hint">At least 6 letters, so it does not trigger by accident.</span>
              </div>
            )}
            <div className="item col">
              <span>On-screen ask button</span>
              <Segmented<number> label="On-screen ask button" value={s.holdMs}
                options={[{ value: 0, label: 'Tap' }, { value: 1000, label: 'Hold 1 s' }, { value: 3000, label: 'Hold 3 s' }]}
                onChange={(holdMs) => set({ holdMs: holdMs as Settings['holdMs'] })} />
            </div>
            <div className="item col">
              <div className="item-line">
                <span>Use headset play/pause button to Ask</span>
                <Switch label="Use headset play/pause button to Ask" checked={s.earbudAsk} onChange={(earbudAsk) => set({ earbudAsk })} />
              </div>
              <p className="hint">While Exam Mate is reading, press your headset&rsquo;s main play/pause button once. Reading pauses and Ask starts listening immediately, without a spoken wake phrase or a previous/next-track button. After the answer, reading resumes. When the reader is already paused, play resumes it normally. The shortcut works when the phone forwards a standard play/pause event.</p>
            </div>
          </>
        )}
      </div>
      {assistMsg && <p className="foot warn" role="alert">{assistMsg}</p>}
      <p className="foot">
        While you are reading, say the wake phrase (or use the ask button), then your question. Exam Mate pauses, answers out loud,
        and carries on where it stopped. You can also say &ldquo;next&rdquo;, &ldquo;repeat&rdquo;, &ldquo;go back&rdquo;, &ldquo;pause&rdquo;,
        &ldquo;continue&rdquo;, &ldquo;slow down&rdquo; or &ldquo;stop&rdquo;. It works best with earbuds.
      </p>
      <p className="foot">
        Listening uses your phone&rsquo;s speech-recognition service and may send audio to that provider for processing. It runs only while a reading
        session is open and Exam Mate is active. Use the wake phrase, on-screen Ask control, or enable the headset play/pause shortcut above. The shortcut uses the standard play/pause event exposed by your headset and operating system. Bluetooth, USB-C, Lightning and compatible 3.5 mm audio routing is managed by iOS or Android.
        Connect your headset before starting voice Ask; the operating system selects its microphone when the connected headset exposes one to the speech service.
      </p>

      {showNativeAudioRoutes && <>
        <div className="section-label">Headphones &amp; audio</div>
        <div className="list glass">
          <div className="item col">
            <div className="item-line"><span>Devices reported by the phone</span><button className="btn tinted sm" onClick={onCheckAudioDevices} disabled={audioDevicesLoading}>{audioDevicesLoading ? 'Checking…' : 'Refresh'}</button></div>
            {audioDevices && <>
              <p className="hint"><b>Outputs:</b> {audioDevices.outputs.length ? audioDevices.outputs.join(' · ') : 'No output device reported'}</p>
              <p className="hint"><b>Inputs:</b> {audioDevices.inputs.length ? audioDevices.inputs.join(' · ') : 'No input device reported'}</p>
            </>}
            {!audioDevices && <p className="hint">{audioDevicesChecked ? 'The phone did not return audio-device information.' : 'Refresh to check audio devices visible to the operating system.'}</p>}
          </div>
        </div>
        <p className="foot">The operating system selects the actual playback and microphone routes. Android lists available audio devices; iPhone reports its current audio route.</p>
      </>}

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
      {!speech && <p className="foot warn">Speech output is unavailable in this browser. Use a supported browser or install the native Exam Mate app on Android or iPhone.</p>}
      <p className="foot">Headset controls: with the Ask shortcut off, play/pause toggles reading; next track moves forward; previous track goes back; and rewind repeats the current phrase when exposed. With the Ask shortcut on, pressing play/pause while reading opens voice Ask; pressing play while paused resumes reading. Next and previous retain their navigation functions. The headset and phone determine which hardware events are exposed.</p>
    </>
  );
}
