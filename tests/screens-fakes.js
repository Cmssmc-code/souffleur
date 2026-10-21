/* Faux périphériques déterministes pour les tests des écrans secondaires :
   synthèse vocale, reconnaissance vocale (réponse dictée scriptée) et partage d'onglet avec son.
   Options via l'URL : ?mic-denied (reconnaissance refusée), ?display-noaudio (partage sans son). */
(function () {
  'use strict';
  const qs = new URLSearchParams(location.search);

  class FakeUtterance {
    constructor(t) { this.text = t; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; this.onend = null; this.onerror = null; }
  }
  let speaking = null;
  const fakeSynth = {
    getVoices: () => [{ name: 'Microsoft Denise Online (Natural)', lang: 'fr-FR', localService: false }],
    addEventListener() {}, removeEventListener() {},
    speak(u) {
      speaking = u;
      window.__spoken = (window.__spoken || []).concat(u.text);
      setTimeout(() => { if (speaking === u) { speaking = null; if (u.onend) u.onend(); } }, 400);
    },
    cancel() { const u = speaking; speaking = null; if (u && u.onerror) u.onerror({ error: 'interrupted' }); }
  };
  Object.defineProperty(window, 'speechSynthesis', { value: fakeSynth, configurable: true });
  window.SpeechSynthesisUtterance = FakeUtterance;

  const ANSWER = 'J’ai piloté la clôture mensuelle de trois filiales et réduit les délais de cinq jours grâce à un rétroplanning partagé';
  class FakeRecognition {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this._timers = []; this._alive = false; }
    start() {
      this._alive = true;
      window.__recStarts = (window.__recStarts || 0) + 1;
      if (qs.has('mic-denied')) { this._t(() => { if (this.onerror) this.onerror({ error: 'not-allowed' }); if (this.onend) this.onend(); }, 50); return; }
      this._t(() => { if (this.onstart) this.onstart(); }, 30);
      const words = ANSWER.split(' ');
      const results = [];
      words.forEach((w, i) => this._t(() => {
        const r = [{ transcript: words.slice(0, i + 1).join(' ') }];
        r.isFinal = i === words.length - 1;
        results[0] = r;
        if (this.onresult) this.onresult({ resultIndex: 0, results });
      }, 300 + i * 110));
    }
    _t(fn, ms) { this._timers.push(setTimeout(() => { if (this._alive) fn(); }, ms)); }
    stop() { this.abort(); }
    abort() { this._alive = false; this._timers.forEach(clearTimeout); }
  }
  window.webkitSpeechRecognition = FakeRecognition;
  window.SpeechRecognition = FakeRecognition;

  if (navigator.mediaDevices) {
    navigator.mediaDevices.getDisplayMedia = async function () {
      const cv = document.createElement('canvas');
      if (qs.has('display-noaudio')) return cv.captureStream(5);
      const ac = new AudioContext();
      const osc = ac.createOscillator();
      const g = ac.createGain();
      g.gain.value = 0.3;
      const dest = ac.createMediaStreamDestination();
      osc.connect(g); g.connect(dest); osc.start();
      return new MediaStream([...cv.captureStream(5).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    };
  }
})();
