// Synthesized sound effects via the Web Audio API -- no audio asset files to
// add or license. Each sound is a short procedural blip; add new cases to
// SoundName/playSound as more effects are needed.

export type SoundName = "tileDrop";

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function playClick(ctx: AudioContext) {
  const duration = 0.02;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = 800;
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
  osc.onended = () => {
    osc.disconnect();
    gain.disconnect();
  };
}

export function playSound(name: SoundName, enabled: boolean): void {
  if (!enabled) return;
  const ctx = getAudioContext();
  switch (name) {
    case "tileDrop":
      playClick(ctx);
      break;
  }
}
