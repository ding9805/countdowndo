import confetti from 'canvas-confetti';

/**
 * Plays a celebratory hooray sound using Web Audio API
 */
export const playHooraySound = () => {
  try {
    // Create multiple oscillators for a fun, celebratory sound
    const frequencies = [523.25, 659.25, 783.99]; // C, E, G notes (major chord)
    const audioContext: AudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = audioContext.currentTime;
    const duration = 0.8;
    // Longest scheduled note: the last oscillator starts at index * 0.1.
    const totalDuration = duration + (frequencies.length - 1) * 0.1;

    frequencies.forEach((freq, index) => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = freq;
      oscillator.type = 'sine';

      // Stagger the start times for a "rising" effect
      const startTime = now + index * 0.1;
      gainNode.gain.setValueAtTime(0.3, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

      oscillator.start(startTime);
      oscillator.stop(startTime + duration);
    });

    // Release the short-lived context once the last note has finished. Without
    // this every celebration leaks an AudioContext, and browsers cap how many
    // a page may hold — past the cap `new AudioContext()` throws and all sound
    // stops working until reload. Mirrors playTimerSound in lib/use-timer-sound.
    window.setTimeout(() => { void audioContext.close(); }, (totalDuration + 0.2) * 1000);
  } catch (error) {
    console.error('Failed to play celebration sound:', error);
  }
};

/**
 * Triggers confetti animation with celebration sound
 */
export const celebrate = () => {
  // Play sound
  playHooraySound();

  // Trigger confetti from center
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.5, x: 0.5 },
    startVelocity: 80,
  });

  // Second burst slightly delayed
  setTimeout(() => {
    confetti({
      particleCount: 50,
      spread: 100,
      origin: { y: 0.3, x: Math.random() },
      startVelocity: 60,
    });
  }, 150);
};
