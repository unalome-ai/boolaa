"use client";

import { useSyncExternalStore } from "react";

/**
 * "Take photo" (docs/boolaa-spec.md, Images → Camera). The web opens the camera through a file input with
 * `capture`, which mobile browsers honour and desktop browsers ignore (they show the file chooser again). So
 * the camera button is offered only where the primary pointer is touch; desktop keeps one "Choose a photo".
 */
const QUERY = "(pointer: coarse)";

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

/** True on touch devices, where `<input capture>` opens the camera. False on the server and on desktop. */
export function canTakePhoto(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/** Reactive {@link canTakePhoto}; false during SSR and hydration, so the markup never mismatches. */
export function useCanTakePhoto(): boolean {
  return useSyncExternalStore(subscribe, canTakePhoto, () => false);
}

/** Which camera `capture` asks for: the selfie camera for avatars, the back camera for everything else. */
export type CameraFacing = "user" | "environment";
