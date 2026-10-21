"use client";
import React, { useState, useEffect } from 'react';
import { useTTS } from '../src/hooks/useTTS';
import { useVoiceTrigger } from '../src/hooks/useVoiceTrigger';
import { useVAD } from '../src/hooks/useVAD';
import { AIService } from '../src/services/ai-service';
import { HapticPatterns } from '../src/lib/haptics';
import { Preferences } from '@capacitor/preferences';
import { LicenseService } from '../src/services/license-service';
import { OnboardingWizard } from '../src/components/OnboardingWizard';

export default function ExamMateApp() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [text, setText] = useState('');
  const [phrases, setPhrases] = useState<string[]>([]);
  const [options, setOptions] = useState({
    rate: 0.5,
    gapS: 2.0,
    pw: 0.75,
    mode: 'clause',
    twice: false,
    punct: true,
  });

  const { state, run, stop, interrupt, idx, progress } = useTTS(phrases, options);
  const { toggleListening, startHoldTrigger, stopHoldTrigger } = useVoiceTrigger(async (mode) => {
    await HapticPatterns.triggerStart();
    const currentIdx = interrupt();

    // Start VAD to detect when the user finishes speaking
    handleVoiceInput(currentIdx);
  });

  const { startMonitoring, stopMonitoring } = useVAD(async () => {
    // This is called when silence is detected
    await processVoiceCommand();
  });

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const authorized = await LicenseService.checkLocalBinding();
    setIsAuthorized(authorized);
  };

  const handleVoiceInput = async (resumeIdx: number) => {
    await startMonitoring();
    // we need to capture the transcript here from the voice trigger
    // for the sake of this architecture, we'll use a shared state or a callback
  };

  const processVoiceCommand = async () => {
    const { value: apiKey } = await Preferences.get({ key: 'gemini_api_key' });
    // In a real app, we capture the transcript from the VoiceTrigger
    const transcript = "Example question or repeat";

    const response = await AIService.getIntentAndAnswer(transcript, options.mode, apiKey || '');

    if (response.type === 'COMMAND') {
      switch (response.payload) {
        case 'REPEAT': run(idx); break;
        case 'BACK': run(idx - 1); break;
        case 'NEXT': run(idx + 1); break;
        case 'STOP': stop(); break;
      }
    } else {
      // Answer new question
      const answerPhrases = splitText(response.payload, options.mode);
      setPhrases(answerPhrases);
      run(0);
    }

    await HapticPatterns.aiFinish();
    stopMonitoring();
  };

  const splitText = (text: string, mode: string) => {
    // Ported from original slow-reader.html
    const modeMap: Record<string, number> = { w2: 2, w3: 3, w5: 5 };
    const n = modeMap[mode] || 0;
    const end = mode === 'sentence' ? /[.!?…]["'”’)\]]*$/ : /[.!?…,;:—–]["'”’)\]]*$/;
    const out: string[] = [];
    text.split(/\n+/).forEach(line => {
      let cur: string[] = [];
      line.trim().split(/\s+/).filter(Boolean).forEach(w => {
        cur.push(w);
        if (end.test(w) || (n && cur.length >= n)) {
          out.push(cur.join(' '));
          cur = [];
        }
      });
      if (cur.length) out.push(cur.join(' '));
    });
    return out;
  };

  if (!isAuthorized) {
    return <OnboardingWizard onComplete={() => setIsAuthorized(true)} />;
  }

  return (
    <div className="app-container">
      <header>
        <h1>Exam Mate</h1>
        <div className="status-bar">{state}</div>
      </header>

      <main>
        <section className="reader-card">
          <div className="current-phrase">{phrases[idx] || 'Ready to read...'}</div>
          <div className="progress-text">{progress}</div>

          <div className="controls">
            <button onMouseDown={startHoldTrigger} onMouseUp={stopHoldTrigger} className="hold-btn">
              Hold to Ask
            </button>
            <div className="nav-btns">
              <button onClick={() => run(idx - 1)}>Back</button>
              <button onClick={() => run(idx)}>Repeat</button>
              <button onClick={() => run(idx + 1)}>Next</button>
            </div>
          </div>
        </section>

        <section className="input-card">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste questions or answers here..."
          />
          <button className="start-btn" onClick={() => {
            const p = splitText(text, options.mode);
            setPhrases(p);
            run(0);
          }}>Start Reading</button>
        </section>
      </main>

      <style jsx>{`
        .app-container {
          min-height: 100vh;
          background: #0b1410;
          color: white;
          font-family: 'Manrope', sans-serif;
          padding: 20px;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 30px;
        }
        h1 {
          font-size: 2rem;
          background: linear-gradient(to right, #4fd1a1, #fff);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .status-bar {
          font-size: 0.8rem;
          color: #a4b0a8;
          background: rgba(255,255,255,0.1);
          padding: 4px 12px;
          border-radius: 20px;
        }
        .reader-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 30px;
          padding: 30px;
          text-align: center;
          margin-bottom: 20px;
        }
        .current-phrase {
          font-size: 1.8rem;
          font-weight: 700;
          min-height: 80px;
          margin-bottom: 10px;
        }
        .progress-text {
          color: #a4b0a8;
          margin-bottom: 20px;
        }
        .controls {
          display: flex;
          flex-direction: column;
          gap: 15px;
        }
        .hold-btn {
          background: linear-gradient(135deg, #ffd3a1, #f7a047);
          color: #2a1604;
          border: none;
          padding: 20px;
          border-radius: 20px;
          font-weight: 800;
          font-size: 1.2rem;
          cursor: pointer;
          transition: transform 0.1s;
        }
        .hold-btn:active { transform: scale(0.95); }
        .nav-btns {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .nav-btns button {
          padding: 12px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.05);
          color: white;
          font-weight: 600;
        }
        .input-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 30px;
          padding: 20px;
        }
        textarea {
          width: 100%;
          min-height: 120px;
          background: rgba(0,0,0,0.2);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 15px;
          color: white;
          padding: 15px;
          margin-bottom: 15px;
          box-sizing: border-box;
        }
        .start-btn {
          width: 100%;
          padding: 15px;
          border-radius: 15px;
          border: none;
          background: linear-gradient(135deg, #0f6b4c, #0a4a36);
          color: white;
          font-weight: 700;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
