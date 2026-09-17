import React from "react";
import { View } from "react-native";

export interface MockPlayer {
  play: () => void;
  pause: () => void;
  muted: boolean;
  loop: boolean;
  currentTime: number;
  addListener: (event: string, callback: () => void) => { remove: () => void };
}

export function useVideoPlayer(_source: unknown, setup?: (player: MockPlayer) => void): MockPlayer {
  const player: MockPlayer = {
    play: () => {},
    pause: () => {},
    muted: false,
    loop: false,
    currentTime: 0,
    addListener: () => ({ remove: () => {} }),
  };
  setup?.(player);
  return player;
}

export function VideoView(props: React.ComponentProps<typeof View> & { player?: unknown; nativeControls?: boolean }) {
  return React.createElement(View, { testID: "mock-video-view", ...props });
}
