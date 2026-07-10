import confetti from 'canvas-confetti';

/**
 * Plays a celebratory hooray sound using Web Audio API
 */
export const playHooraySound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const now = audioContext.currentTime;
    const duration = 0.8;

    // Create multiple oscillators for a fun, celebratory sound
    const frequencies = [523.25, 659.25, 783.99]; // C, E, G notes (major chord)

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
