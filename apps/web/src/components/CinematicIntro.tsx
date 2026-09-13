import { useEffect, useRef, useState } from "react";

export function CinematicIntro() {
  const [visible, setVisible] = useState(true);
  const [closing, setClosing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.currentTime = 0;
      // Try playing with sound; if browser autoplay policy blocks unmuted audio, fallback to muted so it never fails
      video.muted = false;
      const promise = video.play();
      if (promise !== undefined) {
        promise.catch(() => {
          if (videoRef.current) {
            videoRef.current.muted = true;
            void videoRef.current.play().catch(() => {});
          }
        });
      }
    }

    // Support replay trigger if requested via custom event
    const handleReplay = () => {
      setClosing(false);
      setVisible(true);
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.muted = false;
        const p = videoRef.current.play();
        if (p !== undefined) {
          p.catch(() => {
            if (videoRef.current) {
              videoRef.current.muted = true;
              void videoRef.current.play().catch(() => {});
            }
          });
        }
      }
    };

    window.addEventListener("ailss-play-intro", handleReplay);
    return () => window.removeEventListener("ailss-play-intro", handleReplay);
  }, []);

  const handleEnded = () => {
    setClosing(true);
    setTimeout(() => {
      setVisible(false);
      setClosing(false);
    }, 800);
  };

  if (!visible) return null;

  return (
    <aside
      className={`cinematic-intro-overlay ${closing ? "closing" : ""}`}
      aria-label="Video giới thiệu"
      aria-hidden={closing ? "true" : "false"}
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
        onEnded={handleEnded}
      />
      <div className="cinematic-corner-mask" aria-hidden="true" />
    </aside>
  );
}
