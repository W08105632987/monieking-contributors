import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ShieldCheck, Users, TrendingUp, Sparkles, Wallet, Crown, User, CalendarDays, Settings, Bot, BadgeCheck, CheckCircle2 } from "lucide-react";
import { OrbitRing, type OrbitBadge } from "./OrbitRing";

import onb1 from "@/assets/onb-1.jpg";
import onb2 from "@/assets/onb-2.jpg";
import onb3 from "@/assets/onb-3.jpg";
import onb4 from "@/assets/onb-4.jpg";

// Premium onboarding: photo hero card (faces stay clear of the copy),
// swipeable, with the copy in its own panel beneath. Dark-only by design.

const slides = [
  {
    image: onb1,
    eyebrow: "Welcome",
    icon: Sparkles,
    titleLead: "Welcome to",
    titleAccent: "MonieKing",
    pos: "50% 58%",
    badges: [{ icon: Wallet, angle: 315, radius: 52 }, { icon: TrendingUp, angle: 42, radius: 52 }, { icon: Crown, angle: 150, radius: 50, accent: true }] as OrbitBadge[],
    body: "Nigeria's digital contribution savings platform — a modern ajo and esusu, right on your phone.",
  },
  {
    image: onb2,
    eyebrow: "Savings circles",
    icon: Users,
    titleLead: "Save With People",
    titleAccent: "You Trust",
    pos: "50% 62%",
    badges: [{ icon: User, angle: 0, radius: 54 }, { icon: User, angle: 222, radius: 50 }, { icon: User, angle: 138, radius: 50 }, { icon: Users, angle: 295, radius: 52, accent: true }] as OrbitBadge[],
    body: "Create a circle with family, friends or colleagues. Everyone contributes, everyone gets their turn.",
  },
  {
    image: onb3,
    eyebrow: "Automatic",
    icon: TrendingUp,
    titleLead: "Contributions On",
    titleAccent: "Autopilot",
    pos: "50% 56%",
    badges: [{ icon: CalendarDays, angle: 318, radius: 52 }, { icon: Settings, angle: 40, radius: 52 }, { icon: Bot, angle: 215, radius: 50, accent: true }] as OrbitBadge[],
    body: "Set your amount and schedule once. We collect, track and pay out — no chasing, no spreadsheets.",
  },
  {
    image: onb4,
    eyebrow: "Protected",
    icon: ShieldCheck,
    titleLead: "Your Money Stays",
    titleAccent: "Protected",
    pos: "50% 50%",
    badges: [{ icon: ShieldCheck, angle: 135, radius: 50, size: 22, accent: true }, { icon: CheckCircle2, angle: 225, radius: 50 }, { icon: BadgeCheck, angle: 35, radius: 52 }] as OrbitBadge[],
    body: "Bank-level security, verified members and a clear record of every naira that moves in your circle.",
  },
];

interface OnboardingScreenProps {
  /** When set (e.g. the signed-in "About" modal) the last slide just calls this instead of going to Register. */
  onFinish?: () => void;
}

const SWIPE = 55;
const pad = (n: number) => String(n).padStart(2, "0");

export function OnboardingScreen({ onFinish }: OnboardingScreenProps = {}) {
  // Decode every slide picture up front so a swipe never waits on the network or the image decoder.
  useEffect(() => {
    slides.forEach((sl) => { const im = new Image(); im.src = sl.image; im.decode?.().catch(() => {}) })
  }, [])
  const navigate = useNavigate();
  const [[index, dir], setPage] = useState<[number, number]>([0, 0]);
  const last = index === slides.length - 1;

  const go = useCallback((next: number) => {
    setPage(([cur]) => {
      const n = Math.max(0, Math.min(slides.length - 1, next));
      return n === cur ? [cur, 0] : [n, n > cur ? 1 : -1];
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  useEffect(() => {
    slides.forEach((s) => { const i = new Image(); i.src = s.image; });
  }, []);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -SWIPE || info.velocity.x < -400) go(index + 1);
    else if (info.offset.x > SWIPE || info.velocity.x > 400) go(index - 1);
  };

  const finish = () => (onFinish ? onFinish() : navigate("/auth/register"));

  const slide = slides[index]!;
  const accentIsBrand = slide.titleAccent === "MonieKing";

  return (
    <main className="relative h-dvh max-h-dvh w-full overflow-hidden bg-[#02100a] text-white select-none">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(70% 45% at 50% 28%, rgba(16,185,129,0.20), transparent 70%), radial-gradient(60% 40% at 50% 105%, rgba(16,185,129,0.14), transparent 70%), linear-gradient(180deg,#03160e 0%,#02100a 60%,#010a06 100%)",
        }}
      />

      <div className="relative mx-auto flex h-full w-full max-w-md flex-col px-6 pt-safe pt-3 pb-safe pb-5 sm:max-w-xl lg:max-w-6xl lg:flex-row-reverse lg:items-center lg:gap-16 lg:px-12">
        {/* swipeable stage: picture + words move together */}
        <motion.div
          className="flex min-h-0 flex-1 flex-col lg:contents"
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.15}
          onDragEnd={onDragEnd}
          style={{ touchAction: "pan-y" }}
        >
          <div className="flex min-h-0 w-full flex-1 items-center justify-center py-2 lg:h-[34rem] lg:flex-[1.1] lg:py-0" style={{ containerType: "size" }}>
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={index}
                custom={dir}
                variants={{
                  enter: (d: number) => ({ x: d >= 0 ? 40 : -40, opacity: 0, scale: 0.96 }),
                  center: { x: 0, opacity: 1, scale: 1 },
                  exit: (d: number) => ({ x: d >= 0 ? -40 : 40, opacity: 0, scale: 0.97, transition: { duration: 0.14 } }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className="shrink-0"
                style={{ width: "min(100cqw, 100cqh)", height: "min(100cqw, 100cqh)", willChange: "transform, opacity" }}
              >
                <OrbitRing badges={slide.badges}>
                  <img
                    src={slide.image}
                    alt=""
                    aria-hidden="true"
                    width={896}
                    height={1536}
                    draggable={false}
                    className="h-full w-full object-cover"
                    style={{ objectPosition: slide.pos }}
                  />
                </OrbitRing>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="shrink-0 pt-3 lg:flex-1 lg:pt-0">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="min-h-[10.5rem] sm:min-h-[11.5rem]"
              >
                <span className="inline-flex items-center rounded-full border border-emerald-400/30 bg-emerald-950/70 px-3 py-1 text-xs font-semibold tabular-nums tracking-wider text-zinc-100">
                  {pad(index + 1)} / {pad(slides.length)}
                </span>
                <h1 className="mt-3 font-display text-[1.9rem] font-extrabold leading-[1.1] tracking-tight sm:text-4xl lg:text-5xl">
                  <span className="block text-emerald-50">{slide.titleLead}</span>
                  {accentIsBrand ? (
                    <span className="block text-emerald-50">Monie<span className="text-amber-400">King</span></span>
                  ) : (
                    <span className="block text-amber-400 drop-shadow-[0_2px_14px_rgba(245,158,11,0.35)]">{slide.titleAccent}</span>
                  )}
                </h1>
                <p className="mt-2.5 max-w-sm text-sm leading-relaxed text-emerald-100/80 sm:text-base">{slide.body}</p>
              </motion.div>
            </AnimatePresence>

            <div className="mt-3 flex items-center gap-2 lg:hidden">
              {slides.map((s, i) => (
                <button
                  key={s.eyebrow}
                  type="button"
                  aria-label={`Go to step ${i + 1}`}
                  aria-current={i === index}
                  onClick={() => go(i)}
                  className="h-2 rounded-full"
                  style={{
                    width: i === index ? "1.6rem" : "0.5rem",
                    background: i === index ? "#f59e0b" : "rgba(255,255,255,0.22)",
                    transition: "width 250ms cubic-bezier(0.22,1,0.36,1), background-color 250ms",
                  }}
                />
              ))}
            </div>
          </div>
        </motion.div>

        {/* Buttons stay exactly as they were */}
        <div className="shrink-0 pt-4 lg:absolute lg:bottom-12 lg:left-12 lg:w-[26rem] lg:pt-0">
          <div className="mb-3 hidden items-center gap-2 lg:flex">
            {slides.map((s, i) => (
              <button
                key={s.eyebrow}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => go(i)}
                className="h-2 rounded-full"
                style={{ width: i === index ? "1.6rem" : "0.5rem", background: i === index ? "#f59e0b" : "rgba(255,255,255,0.22)", transition: "width 250ms cubic-bezier(0.22,1,0.36,1), background-color 250ms" }}
              />
            ))}
          </div>
          <div className="space-y-2">
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => (last ? finish() : go(index + 1))}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 py-3.5 font-display text-base font-bold text-black shadow-lg shadow-amber-500/25 transition-colors hover:bg-amber-400"
            >
              {last ? (onFinish ? "Done" : "Get Started") : "Continue"}
              <ArrowRight className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
            </motion.button>
            {!onFinish && (
              <button
                type="button"
                onClick={() => navigate("/auth/login")}
                className="w-full rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-zinc-300 backdrop-blur-md transition-colors hover:bg-white/10 hover:text-white active:scale-[0.98]"
              >
                I already have an account
              </button>
            )}
          </div>
        </div>
      </div>

      {!onFinish && (
        <button
          type="button"
          onClick={() => navigate("/auth/login")}
          className="absolute right-5 top-3 z-10 rounded-full px-3 py-1 text-xs font-semibold text-zinc-300 transition-all hover:text-white active:scale-95 sm:text-sm"
          style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          Skip
        </button>
      )}
    </main>
  );
}
