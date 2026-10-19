// Small synthesized sound effects (no audio files needed).
let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.08) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

export function playSound(kind: 'success' | 'wrong' | 'error' | 'level' | 'click') {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (kind === 'success') {
      tone(660, 0, 0.12, 'triangle');
      tone(880, 0.09, 0.18, 'triangle');
    } else if (kind === 'wrong') {
      tone(300, 0, 0.15, 'sine', 0.06);
      tone(240, 0.1, 0.2, 'sine', 0.06);
    } else if (kind === 'error') {
      tone(200, 0, 0.12, 'square', 0.025);
    } else if (kind === 'level') {
      [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.22, 'triangle'));
    } else tone(520, 0, 0.05, 'sine', 0.04);
  } catch {
    /* audio not available */
  }
}
