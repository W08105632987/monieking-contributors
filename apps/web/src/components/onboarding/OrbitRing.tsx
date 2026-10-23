import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

export interface OrbitBadge {
  icon: LucideIcon;
  /** Position on the ring, degrees clockwise from 12 o'clock. */
  angle: number;
  /** Distance from centre as % of the box (50 = on the ring edge). */
  radius?: number;
  /** Badge diameter as % of the box. */
  size?: number;
  /** Highlight (amber glow) variant. */
  accent?: boolean;
}

/**
 * Glowing concentric rings + floating icon badges around a circular
 * centrepiece. Shared by the splash screen and the onboarding slides so
 * both read as one brand system. Fills its (square) parent.
 */
export function OrbitRing({ children, badges = [], spin = true }: { children: ReactNode; badges?: OrbitBadge[]; spin?: boolean }) {
  return (
    <div className="relative h-full w-full">
      {/* outer slow dashed orbit with travelling sparks */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-[-4%] rounded-full border border-dashed border-emerald-400/25"
        animate={spin ? { rotate: 360 } : undefined}
        transition={{ duration: 60, ease: "linear", repeat: Infinity }}
      >
        {[8, 130, 250].map((a, i) => (
          <span
            key={a}
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{
              left: `${50 + 50 * Math.sin((a * Math.PI) / 180)}%`,
              top: `${50 - 50 * Math.cos((a * Math.PI) / 180)}%`,
              transform: "translate(-50%,-50%)",
              background: i === 1 ? "#34d399" : "#f59e0b",
              boxShadow: `0 0 10px 2px ${i === 1 ? "rgba(52,211,153,.7)" : "rgba(245,158,11,.7)"}`,
            }}
          />
        ))}
      </motion.div>

      {/* glowing amber→green ring */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-[3%] rounded-full"
        style={{
          padding: 2,
          background: "conic-gradient(from 200deg, #f59e0b, #10b981 35%, rgba(16,185,129,.1) 60%, #f59e0b)",
          WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
          WebkitMaskComposite: "xor",
          maskComposite: "exclude",
          boxShadow: "0 0 40px rgba(245,158,11,.25)",
        }}
        animate={spin ? { rotate: -360 } : undefined}
        transition={{ duration: 40, ease: "linear", repeat: Infinity }}
      />
      <div aria-hidden="true" className="absolute inset-[3%] rounded-full" style={{ boxShadow: "0 0 60px 6px rgba(16,185,129,.18), inset 0 0 40px rgba(16,185,129,.12)" }} />

      {/* centrepiece */}
      <div className="absolute inset-[9%] overflow-hidden rounded-full ring-1 ring-emerald-300/20">{children}</div>

      {/* badges */}
      {badges.map((b, i) => {
        const r = b.radius ?? 50;
        const s = b.size ?? 17;
        const Icon = b.icon;
        return (
          <motion.span
            key={i}
            className="absolute flex items-center justify-center rounded-full border backdrop-blur-sm"
            style={{
              width: `${s}%`,
              height: `${s}%`,
              left: `${50 + r * Math.sin((b.angle * Math.PI) / 180)}%`,
              top: `${50 - r * Math.cos((b.angle * Math.PI) / 180)}%`,
              marginLeft: `${-s / 2}%`,
              marginTop: `${-s / 2}%`,
              background: "radial-gradient(circle at 30% 30%, rgba(6,60,38,.95), rgba(2,20,12,.95))",
              borderColor: b.accent ? "rgba(245,158,11,.9)" : "rgba(52,211,153,.55)",
              boxShadow: b.accent ? "0 0 22px rgba(245,158,11,.55)" : "0 0 18px rgba(16,185,129,.4)",
            }}
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1, y: [0, -5, 0] }}
            transition={{
              opacity: { delay: 0.15 + i * 0.1, duration: 0.4 },
              scale: { delay: 0.15 + i * 0.1, type: "spring", stiffness: 260, damping: 16 },
              y: { delay: i * 0.4, duration: 3.2 + i * 0.4, repeat: Infinity, ease: "easeInOut" },
            }}
          >
            <Icon className="h-[48%] w-[48%]" style={{ color: b.accent ? "#fbbf24" : "#fcd34d" }} strokeWidth={2} aria-hidden="true" />
          </motion.span>
        );
      })}
    </div>
  );
}
