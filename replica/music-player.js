// Injected into the verified template module; n is React and s is its JSX runtime.
function RoyalMusicPlayer({config}) {
  const audio = n.useRef(null);
  const defaultOn = Boolean(config?.enabled && config?.src && config?.defaultOn);
  const desired = n.useRef(defaultOn);
  const [awaitingEntrance, setAwaitingEntrance] = n.useState(defaultOn);
  const touched = n.useRef(false);
  const attempt = n.useRef(0);
  const [playing, setPlaying] = n.useState(false);
  const [loading, setLoading] = n.useState(false);
  const [failed, setFailed] = n.useState(false);
  const [mounted, setMounted] = n.useState(false);
  const enabled = Boolean(config?.enabled && config.src);

  // The preserved server snapshot has no player; match it during hydration.
  n.useEffect(() => { setMounted(true); }, []);

  function stop() {
    desired.current = false;
    setAwaitingEntrance(false);
    attempt.current++;
    audio.current?.pause();
    setPlaying(false);
    setLoading(false);
  }

  function skipIntro() {
    const element = audio.current;
    const offset = Number(config?.startAtSeconds) || 0;
    if (!element || !element.readyState || offset <= 0) return;
    if (Number.isFinite(element.duration) && offset >= element.duration) return;
    if (element.currentTime < offset) element.currentTime = offset;
  }

  function start() {
    const element = audio.current;
    if (!enabled || !element || (!element.paused && desired.current)) return;
    desired.current = true;
    setAwaitingEntrance(false);
    const currentAttempt = ++attempt.current;
    element.volume = config.volume ?? 0.25;
    setFailed(false);
    setLoading(true);
    // Called synchronously from the gateway/button gesture for mobile playback.
    try {
      skipIntro();
      Promise.resolve(element.play()).then(() => {
        if (currentAttempt !== attempt.current) return;
        setLoading(false);
        setPlaying(desired.current && !element.paused);
      }).catch((error) => {
        if (currentAttempt !== attempt.current) return;
        const blocked = error?.name === 'NotAllowedError';
        desired.current = blocked;
        setAwaitingEntrance(blocked);
        setLoading(false);
        setPlaying(false);
        setFailed(!blocked);
      });
    } catch {
      desired.current = false;
      setLoading(false);
      setPlaying(false);
      setFailed(true);
    }
  }

  n.useEffect(() => {
    if (!enabled) return;
    const open = () => {
      if (config.startOnEntrance && !touched.current) start();
    };
    const gesture = (event) => {
      if (event.target?.closest?.('.rgw-music-toggle')) return;
      if (config.autoPlay && defaultOn && !touched.current && audio.current?.paused) start();
    };
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    window.addEventListener('royal-gateway-open', open);
    return () => {
      window.removeEventListener('royal-gateway-open', open);
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
      desired.current = false;
      attempt.current++;
      audio.current?.pause();
    };
  }, [enabled, config?.src, config?.startOnEntrance, config?.autoPlay, defaultOn]);

  n.useEffect(() => {
    if (mounted && enabled && config.autoPlay && defaultOn && !touched.current) start();
  }, [mounted, enabled, config?.src, config?.autoPlay, defaultOn]);

  if (!enabled || !mounted) return null;
  const active = playing || loading || (awaitingEntrance && !config.autoPlay);
  const label = active ? 'Turn music off' : failed ? 'Retry music' : 'Play music';
  return s.jsxs(s.Fragment, {children: [
    s.jsx('audio', {
      ref: audio, src: config.src, preload: config.autoPlay ? 'auto' : 'none', loop: config.loop !== false,
      onLoadedMetadata: skipIntro,
      onTimeUpdate: skipIntro,
      onPlaying: () => {
        if (!desired.current) { audio.current?.pause(); return; }
        setPlaying(true); setLoading(false);
      },
      onPause: () => setPlaying(false),
      onEnded: () => { desired.current = false; setPlaying(false); },
      onError: () => { stop(); setFailed(true); }
    }),
    s.jsxs('button', {
      type: 'button', className: 'rgw-music-toggle',
      'aria-label': label, 'aria-pressed': active,
      title: label + ' · ' + config.title + (awaitingEntrance ? (config.autoPlay ? ' · Tap anywhere to start music' : ' · Starts when you open the invitation') : ''),
      onClick: () => {
        touched.current = true;
        if (awaitingEntrance && config.autoPlay) start(); else if (desired.current) stop(); else start();
      },
      children: [
        s.jsxs('svg', {viewBox: '0 0 24 24', width: 20, height: 20,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
          children: [
            s.jsx('path', {d: 'M11 5 6 9H3v6h3l5 4V5Z'}),
            active ? s.jsx('path', {d: 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14'})
              : s.jsx('path', {d: 'm16 9 5 6m0-6-5 6'})
          ]}),
        s.jsx('span', {children: loading ? 'Loading…' : awaitingEntrance && config.autoPlay ? 'Tap for music' : playing || awaitingEntrance ? 'Music on' : failed ? 'Retry music' : 'Music off'})
      ]
    })
  ]});
}
