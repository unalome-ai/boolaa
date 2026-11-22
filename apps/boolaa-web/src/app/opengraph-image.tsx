import { ImageResponse } from "next/og";

export const alt = "Boolaa: private bubbles for your people";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

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
          background: "linear-gradient(135deg, #9D78BD 0%, #7B61FF 100%)",
          color: "white",
          position: "relative",
        }}
      >
        <div style={{ position: "absolute", right: -80, top: -60, width: 420, height: 420, borderRadius: 9999, background: "rgba(255,255,255,0.18)" }} />
        <div style={{ position: "absolute", right: 160, bottom: -120, width: 320, height: 320, borderRadius: 9999, background: "rgba(255,180,217,0.35)" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 84, height: 84, borderRadius: 9999, background: "white", color: "#7B61FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 60, fontWeight: 900 }}>
            b
          </div>
          <div style={{ fontSize: 64, fontWeight: 900 }}>boolaa</div>
        </div>
        <div style={{ marginTop: 40, fontSize: 76, fontWeight: 900, lineHeight: 1.05, maxWidth: 900 }}>Your people, in one cosy bubble</div>
        <div style={{ marginTop: 24, fontSize: 32, opacity: 0.9 }}>Private · invite-only · ad-free</div>
      </div>
    ),
    size,
  );
}
