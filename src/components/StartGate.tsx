export function StartGate() {
  return (
    <div className="start-gate">
      <div className="start-gate-inner">
        <h1 className="text-3xl font-semibold tracking-tight">
          <span className="text-cyan">2020</span>Tok
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted">
          A feed of TikToks from 2020. Tap Start Scrolling to begin. After that, the play button starts a new random video the same way. The arrows move through videos you have already watched.
        </p>
        <div className="start-gate-button">Start Scrolling</div>
      </div>
    </div>
  );
}
