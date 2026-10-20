let audio: AudioContext | null = null;
export async function enableCompletionSound() {
  if (typeof AudioContext === 'undefined')
    throw new Error('Completion sound is unavailable in this browser.');
  audio ??= new AudioContext();
  if (audio.state === 'suspended') await audio.resume();
}
export function playCompletionSound() {
  if (!audio || audio.state !== 'running') return;
  const gain = audio.createGain();
  gain.connect(audio.destination);
  const now = audio.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  const oscillator = audio.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(659.25, now);
  oscillator.frequency.setValueAtTime(880, now + 0.18);
  oscillator.connect(gain);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
  oscillator.start(now);
  oscillator.stop(now + 0.55);
}
