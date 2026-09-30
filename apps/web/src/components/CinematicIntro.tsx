import { useEffect, useRef, useState } from "react";

export function CinematicIntro() {
  const [visible, setVisible] = useState(true);
  const [closing, setClosing] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.playbackRate = 1.5;
      video.currentTime = 0;
      video.volume = 1.0;
      // Start completely muted so no sound plays automatically on Home
      video.muted = true;
      void video.play().catch(() => {});
    }

    // Support replay trigger if requested via custom event
    const handleReplay = () => {
      setClosing(false);
      setVisible(true);
      if (videoRef.current) {
        videoRef.current.playbackRate = 1.5;
        videoRef.current.currentTime = 0;
        videoRef.current.volume = 1.0;
        videoRef.current.muted = false;
        setIsMuted(false);
        const p = videoRef.current.play();
        if (p !== undefined) {
          p.catch(() => {
            if (videoRef.current) {
              videoRef.current.playbackRate = 1.5;
              videoRef.current.muted = true;
              setIsMuted(true);
              void videoRef.current.play().catch(() => {});
            }
          });
        }
      }
    };

    window.addEventListener("ailss-play-intro", handleReplay);

    // Safety timeout in case video stalls or fails to trigger onEnded (adjusted for 1.5x speed)
    const safetyTimer = setTimeout(() => {
      handleEnded();
    }, 10000);

    return () => {
      clearTimeout(safetyTimer);
      window.removeEventListener("ailss-play-intro", handleReplay);
    };
  }, []);

  const handleEnded = () => {
    setClosing(true);
    setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, 800);
  };

  const handleSkip = (e: React.MouseEvent) => {
    e.stopPropagation();
    handleEnded();
  };

  const toggleSound = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (videoRef.current) {
      videoRef.current.playbackRate = 1.5;
      const nextMuted = !videoRef.current.muted;
      videoRef.current.muted = nextMuted;
      videoRef.current.volume = 1.0;
      setIsMuted(nextMuted);
      if (!nextMuted) {
        void videoRef.current.play().catch(() => {});
      }
    }
  };

  const handleOverlayClick = () => {
    if (videoRef.current && videoRef.current.muted) {
      videoRef.current.playbackRate = 1.5;
      videoRef.current.muted = false;
      videoRef.current.volume = 1.0;
      setIsMuted(false);
      void videoRef.current.play().catch(() => {});
    }
  };

  if (!visible) return null;

  return (
    <aside
      className={`cinematic-intro-overlay ${closing ? "closing" : ""}`}
      aria-label="Video giới thiệu"
      aria-hidden={closing ? "true" : "false"}
      onClick={handleOverlayClick}
      onContextMenu={(e) => e.preventDefault()}
    >
      <video
        ref={videoRef}
        className="cinematic-fullscreen-video"
        src="/assets/intro_cinematic.mp4"
        playsInline
        autoPlay
        controls={false}
        disablePictureInPicture
        disableRemotePlayback
        tabIndex={-1}
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = 1.5;
        }}
        onPlay={(e) => {
          e.currentTarget.playbackRate = 1.5;
        }}
        onEnded={handleEnded}
      />

      {/* Interactive Controls Overlay */}
      <div className="cinematic-controls">
        <button
          type="button"
          className={`cinematic-audio-btn ${isMuted ? "pulse" : "active"}`}
          onClick={toggleSound}
          aria-label={isMuted ? "Bật âm thanh video giới thiệu" : "Tắt âm thanh video giới thiệu"}
        >
          {isMuted ? "🔇 Bật âm thanh" : "🔊 Đang phát âm thanh"}
        </button>
        <button
          type="button"
          className="cinematic-skip-btn"
          onClick={handleSkip}
          aria-label="Bỏ qua video giới thiệu"
        >
          Bỏ qua ✕
        </button>
      </div>

      {isMuted && (
        <div className="cinematic-unmute-hint" aria-hidden="true">
          Nhấn bất kỳ đâu để bật âm thanh 🔊
        </div>
      )}
    </aside>
  );
}
