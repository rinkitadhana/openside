const playClickSound = () => {
  try {
    const audioContext = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();

    fetch("/audio/click.mp3")
      .then((response) => response.arrayBuffer())
      .then((data) => audioContext.decodeAudioData(data))
      .then((audioBuffer) => {
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();

        source.buffer = audioBuffer;
        gainNode.gain.value = 0.6;

        source.connect(gainNode);
        gainNode.connect(audioContext.destination);

        source.start(0);

        source.onended = () => {
          audioContext.close();
        };
      })
      .catch((error) => {
        console.error("Error playing click sound:", error);
      });
  } catch {
    const audio = new Audio("/audio/click.mp3");
    audio.volume = 0.3;
    audio.play().catch((err) => console.error("Audio fallback error:", err));
  }
};

export default playClickSound;
