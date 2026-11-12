'use client';

import { useEffect, useRef, useState } from 'react';
import { mediaToolBySlug } from '@/lib/mediaTools';

// Advanced browser-native media tools. Currently: Text-to-Speech via the Web
// Speech API (window.speechSynthesis) — no library, no network.
export default function MediaTool({ slug }) {
  const cfg = mediaToolBySlug(slug);
  if (!cfg) return null;
  if (cfg.kind === 'tts') return <TextToSpeech blurb={cfg.blurb} />;
  return null;
}

function TextToSpeech({ blurb }) {
  const [text, setText] = useState('Hello! This text is being read aloud, right here in your browser.');
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [supported, setSupported] = useState(true);
  const utterRef = useRef(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) { setSupported(false); return; }
    const load = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      setVoiceURI((cur) => cur || (list.find((v) => /en[-_]/i.test(v.lang))?.voiceURI || list[0]?.voiceURI || ''));
    };
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { try { window.speechSynthesis.cancel(); } catch {} };
  }, []);

  const speak = () => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.voiceURI === voiceURI);
    if (v) u.voice = v;
    u.rate = rate; u.pitch = pitch;
    u.onend = () => { setSpeaking(false); setPaused(false); };
    u.onerror = () => { setSpeaking(false); setPaused(false); };
    utterRef.current = u;
    synth.speak(u);
    setSpeaking(true); setPaused(false);
  };
  const pause = () => { window.speechSynthesis.pause(); setPaused(true); };
  const resume = () => { window.speechSynthesis.resume(); setPaused(false); };
  const stop = () => { window.speechSynthesis.cancel(); setSpeaking(false); setPaused(false); };

  if (!supported) return <p className="mini-error">Your browser doesn’t support speech synthesis. Try Chrome, Edge or Safari.</p>;

  return (
    <div className="mini-tool filetool">
      <div className="mini-fields">
        <p className="filetool-blurb">{blurb}</p>
        <label className="mini-field">
          <span className="mini-field-label">Text</span>
          <textarea className="input mini-area" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="mini-field">
          <span className="mini-field-label">Voice ({voices.length})</span>
          <select className="input" value={voiceURI} onChange={(e) => setVoiceURI(e.target.value)}>
            {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} — {v.lang}</option>)}
          </select>
        </label>
        <label className="mini-field">
          <span className="mini-field-label">Speed: {rate.toFixed(1)}×</span>
          <input type="range" min="0.5" max="2" step="0.1" value={rate} onChange={(e) => setRate(+e.target.value)} />
        </label>
        <label className="mini-field">
          <span className="mini-field-label">Pitch: {pitch.toFixed(1)}</span>
          <input type="range" min="0" max="2" step="0.1" value={pitch} onChange={(e) => setPitch(+e.target.value)} />
        </label>
        <div className="tts-buttons">
          <button type="button" className="btn btn-primary" onClick={speak}>▶ Speak</button>
          {speaking && !paused && <button type="button" className="btn" onClick={pause}>⏸ Pause</button>}
          {speaking && paused && <button type="button" className="btn" onClick={resume}>▶ Resume</button>}
          {speaking && <button type="button" className="btn" onClick={stop}>⏹ Stop</button>}
        </div>
      </div>
      <div className="mini-output">
        <div className="mini-output-head"><span>Status</span></div>
        <p className="mini-note">{speaking ? (paused ? 'Paused.' : 'Speaking…') : 'Ready. Press Speak to listen.'}</p>
        <p className="mini-note">Runs on your device — nothing is uploaded. {voices.length} voices available.</p>
      </div>
    </div>
  );
}
