import React, { useState, useEffect } from 'react';
import { LicenseService } from '../services/license-service';
import { AIService } from '../services/ai-service';
import { Preferences } from '@capacitor/preferences';
import { HapticPatterns } from '../lib/haptics';

export const OnboardingWizard: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [step, setStep] = useState(1);
  const [licenseKey, setLicenseKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState('');

  const handleLicense = async () => {
    setStatus('Validating license...');
    const result = await LicenseService.validateLicense(licenseKey);
    if (result.isValid) {
      setStatus('License active!');
      setTimeout(() => setStep(2), 1000);
    } else {
      setStatus(`Error: ${result.error}`);
    }
  };

  const handleApiKey = async () => {
    setStatus('Saving key...');
    await Preferences.set({ key: 'gemini_api_key', value: apiKey });
    setStatus('Key saved!');
    setTimeout(() => setStep(3), 1000);
  };

  const handleWakeWord = async () => {
    // In a real implementation, this would trigger the recording logic
    setStatus('Wake word configured!');
    setTimeout(() => {
      onComplete();
    }, 1000);
  };

  return (
    <div className="onboarding-container">
      <div className="glass-card">
        {step === 1 && (
          <div className="step">
            <h2>Welcome to Exam Mate</h2>
            <p>Enter your license key to activate the app.</p>
            <input
              type="text"
              placeholder="SLOW-READER-XXXX-XXXX"
              value={licenseKey}
              onChange={(e) => setLicenseKey(e.target.value)}
            />
            <button onClick={handleLicense}>Activate</button>
          </div>
        )}

        {step === 2 && (
          <div className="step">
            <h2>AI Configuration</h2>
            <p>Please enter your Gemini API Key to power the AI.</p>
            <input
              type="password"
              placeholder="Enter API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button onClick={handleApiKey}>Continue</button>
          </div>
        )}

        {step === 3 && (
          <div className="step">
            <h2>Voice Setup</h2>
            <p>Let's set up your custom wake word. Please record yourself saying "Hey Reader" 3 times.</p>
            <div className="recording-dots">
              <div className={`dot ${status.includes('1') ? 'active' : ''}`}></div>
              <div className={`dot ${status.includes('2') ? 'active' : ''}`}></div>
              <div className={`dot ${status.includes('3') ? 'active' : ''}`}></div>
            </div>
            <button onClick={handleWakeWord}>Start Recording</button>
          </div>
        )}

        {status && <p className="status-msg">{status}</p>}
      </div>

      <style jsx>{`
        .onboarding-container {
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          background: radial-gradient(circle at top right, #1a2a23, #0b1410);
          color: white;
          font-family: 'Manrope', sans-serif;
          padding: 20px;
        }
        .glass-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 30px;
          padding: 40px;
          width: 100%;
          max-width: 400px;
          text-align: center;
          box-shadow: 0 20px 40px rgba(0,0,0,0.4);
        }
        .step h2 {
          font-size: 2rem;
          margin-bottom: 1rem;
          background: linear-gradient(to right, #4fd1a1, #fff);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .step p {
          color: #a4b0a8;
          margin-bottom: 2rem;
        }
        input {
          width: 100%;
          padding: 15px;
          border-radius: 12px;
          border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.05);
          color: white;
          margin-bottom: 20px;
          font-size: 1rem;
          text-align: center;
        }
        button {
          width: 100%;
          padding: 15px;
          border-radius: 12px;
          border: none;
          background: linear-gradient(135deg, #0f6b4c, #0a4a36);
          color: white;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.2s;
        }
        button:active { transform: scale(0.95); }
        .status-msg {
          margin-top: 20px;
          font-size: 0.9rem;
          color: #4fd1a1;
        }
        .recording-dots {
          display: flex;
          justify-content: center;
          gap: 15px;
          margin-bottom: 2rem;
        }
        .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: rgba(255,255,255,0.2);
          transition: background 0.3s;
        }
        .dot.active { background: #4fd1a1; box-shadow: 0 0 10px #4fd1a1; }
      `}</style>
    </div>
  );
};
