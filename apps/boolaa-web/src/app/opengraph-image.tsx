import { ImageResponse } from "next/og";

export const alt = "Boolaa: private bubbles for your people";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Orb fills (design-system 4.5).
const GRAPE = "radial-gradient(circle at 35% 30%, #9B86FF 0%, #7357F6 42%, #5B3FD9 80%)";
const CORAL = "radial-gradient(circle at 35% 30%, #FF9A82 0%, #FF6B5C 42%, #E8503F 80%)";
const MINT = "radial-gradient(circle at 35% 30%, #6BE6C6 0%, #1EC8A0 42%, #12A683 80%)";
const SUNNY = "radial-gradient(circle at 35% 30%, #FFE07A 0%, #FFC93C 42%, #F2B21B 80%)";
const SKY = "radial-gradient(circle at 35% 30%, #7CC9FF 0%, #3AA8FF 42%, #1F8DE6 80%)";
const PINK = "radial-gradient(circle at 35% 30%, #FF8CC0 0%, #F0569F 42%, #D63D86 80%)";

/** Social preview drawn from shapes only (no external images or fonts). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: 80,
          background: "linear-gradient(180deg, #E9E0FF 0%, #FBF8FF 55%, #FFEDE3 100%)",
          color: "#1E1638",
          position: "relative",
        }}
      >
        {/* Bubble orbs (design-system 4.5) */}
        <div style={{ position: "absolute", right: 70, top: 90, width: 330, height: 330, borderRadius: 9999, background: GRAPE, display: "flex" }} />
        <div style={{ position: "absolute", right: 120, top: 150, width: 86, height: 52, borderRadius: 9999, background: "rgba(255,255,255,0.6)", transform: "rotate(-35deg)", display: "flex" }} />
        <div style={{ position: "absolute", right: 40, top: 60, width: 120, height: 120, borderRadius: 9999, background: CORAL, display: "flex" }} />
        <div style={{ position: "absolute", right: 30, top: 300, width: 66, height: 66, borderRadius: 9999, background: SUNNY, display: "flex" }} />
        <div style={{ position: "absolute", right: 360, top: 390, width: 90, height: 90, borderRadius: 9999, background: MINT, display: "flex" }} />
        <div style={{ position: "absolute", left: 600, top: -40, width: 110, height: 110, borderRadius: 9999, background: SKY, opacity: 0.45, display: "flex" }} />
        <div style={{ position: "absolute", left: -40, bottom: -50, width: 160, height: 160, borderRadius: 9999, background: PINK, opacity: 0.4, display: "flex" }} />
        <div style={{ fontSize: 72, fontWeight: 900, color: "#5B3FD9", letterSpacing: -2 }}>Boolaa</div>
        <div style={{ marginTop: 24, fontSize: 74, fontWeight: 900, lineHeight: 1.05, maxWidth: 680 }}>Your people, in one cosy bubble</div>
        <div style={{ marginTop: 24, fontSize: 32, color: "#6A6382" }}>Private · invite-only · ad-free</div>
      </div>
    ),
    size,
  );
}
