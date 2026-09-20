import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, ShieldCheck, Users, TrendingUp, Sparkles } from "lucide-react";
import { BrandBlobLogo } from "@/components/brand/BrandBlobLogo";

import onb1 from "@/assets/onb-1.jpg";
import onb2 from "@/assets/onb-2.jpg";
import onb3 from "@/assets/onb-3.jpg";
import onb4 from "@/assets/onb-4.jpg";

// ─────────────────────────────────────────────────────────────────────
// This file is the person's own Lovable-built component, carried over
// as close to verbatim as technically possible — same JSX, same
// classes, same copy, same layout logic. Changes are marked inline
// with "CHANGED:" comments, nothing else touched:
//
//   1. The TanStack Router wrapper (createFileRoute/Route.head) is
//      gone — this app uses React Router, which doesn't have an
//      equivalent, so it's just not applicable here, not a redesign.
//   2. Two buttons had no destination at all in the original
//      (the final slide's primary button did literally nothing when
//      clicked, and "I already have an account" had no onClick
//      handler whatsoever) — those two got a navigate() call each,
//      since a dead button isn't a design choice, it's a bug. The
//      "Skip" button's behavior (jumps to the last slide, doesn't
//      leave onboarding) is UNCHANGED from the original — flagged
//      separately, not silently altered.
//   3. The light/dark toggle (Sun/Moon button + its two effects) is
//      removed by explicit request — it independently flipped the
//      same global `.dark` class this app's own separate real
//      dark-mode system also controls, and the two could fight over
//      it. This is dark-mode-only now, permanently — the underlying
//      color tokens are collapsed to a single palette in index.css
//      (see the comment there), not conditional on `.dark` anymore.
// ─────────────────────────────────────────────────────────────────────

const slides = [
  {
    image: onb1,
    eyebrow: "Welcome",
    icon: Sparkles,
    titleLead: "Welcome to",
    titleAccent: "MonieKing",
    body: "Nigeria's digital contribution savings platform — a modern ajo and esusu, right on your phone.",
  },
  {
    image: onb2,
    eyebrow: "Savings circles",
    icon: Users,
    titleLead: "Save With People",
    titleAccent: "You Trust",
    body: "Create a circle with family, friends or colleagues. Everyone contributes, everyone gets their turn.",
  },
  {
    image: onb3,
    eyebrow: "Automatic",
    icon: TrendingUp,
    titleLead: "Contributions On",
    titleAccent: "Autopilot",
    body: "Set your amount and schedule once. We collect, track and pay out — no chasing, no spreadsheets.",
  },
  {
    image: onb4,
    eyebrow: "Protected",
    icon: ShieldCheck,
    titleLead: "Your Money Stays",
    titleAccent: "Protected",
    body: "Bank-level security, verified members and a clear record of every naira that moves in your circle.",
  },
];

export function OnboardingScreen() {
  const navigate = useNavigate(); // CHANGED: added — needed for the two wired buttons below, see file header
  const [index, setIndex] = useState(0);
  const last = index === slides.length - 1;

  const go = useCallback((next: number) => {
    setIndex(Math.max(0, Math.min(slides.length - 1, next)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(index + 1);
      if (e.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  const slide = slides[index]!;
  const Icon = slide.icon;

  return (
    <main className="relative h-dvh max-h-dvh w-full overflow-hidden bg-black select-none">
      {/* Full-bleed imagery covering the viewport */}
      <div className="absolute inset-0 lg:left-[34%]">
        {slides.map((s, i) => (
          <img
            key={s.image}
            src={s.image}
            alt=""
            aria-hidden="true"
            width={896}
            height={1536}
            loading={i === 0 ? "eager" : "lazy"}
            className="absolute inset-0 h-full w-full object-cover object-[50%_12%] sm:object-[50%_18%] transition-opacity duration-700 ease-out"
            style={{
              opacity: i === index ? 1 : 0,
              transform: i === index ? "scale(1)" : "scale(1.04)",
              transitionProperty: "opacity, transform",
              transitionDuration: "900ms",
            }}
          />
        ))}
        {/* Bottom gradient scrim for rich contrast behind text */}
        <div
          className="absolute inset-0 lg:hidden"
          style={{
            background:
              "linear-gradient(to top, #020503 0%, rgba(2,5,3,0.96) 36%, rgba(2,5,3,0.65) 58%, rgba(2,5,3,0.15) 75%, transparent 100%)",
          }}
        />
        <div
          className="absolute inset-0 hidden lg:block"
          style={{ background: "var(--gradient-scrim-side)" }}
        />
        {/* Top subtle scrim for header readability */}
        <div
          className="absolute inset-x-0 top-0 h-24 pointer-events-none"
          style={{
            background:
              "linear-gradient(to bottom, rgba(2,5,3,0.85) 0%, transparent 100%)",
          }}
        />
      </div>

      <div className="relative mx-auto flex h-full max-h-dvh w-full max-w-md flex-col justify-between px-5 pt-safe pt-3.5 pb-safe pb-5 sm:max-w-xl sm:px-8 sm:pb-7 lg:max-w-6xl lg:px-14 lg:pb-10">
        {/* Top bar — Clean logo with NO green blob splat, Skip button routes to login */}
        <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 shrink-0 z-10">
          <div className="flex min-w-0 items-center gap-3">
            <BrandBlobLogo height={32} hideBlob={true} />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => navigate('/auth/login')}
              className="rounded-full px-3.5 py-1 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white bg-black/40 hover:bg-black/60 border border-white/10 backdrop-blur-md transition-all active:scale-95"
            >
              Skip
            </button>
          </div>
        </header>

        {/* Copy block pinned to the bottom */}
        <div className="w-full max-w-md sm:max-w-lg lg:max-w-xl shrink-0 mt-auto z-10">
          <div
            key={index}
            className="animate-in fade-in slide-in-from-bottom-3 duration-500"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/60 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400 backdrop-blur-md">
              <Icon className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              {slide.eyebrow}
            </span>

            <h1 className="mt-2.5 font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold leading-[1.14] tracking-tight text-white">
              {slide.titleLead}{" "}
              <span className="text-amber-400 drop-shadow-[0_2px_12px_rgba(245,158,11,0.35)]">{slide.titleAccent}</span>
            </h1>

            <p className="mt-2 max-w-sm text-sm sm:text-base leading-relaxed text-zinc-300 line-clamp-3 sm:line-clamp-none">
              {slide.body}
            </p>
          </div>

          {/* Progress indicators */}
          <div className="mt-3.5 sm:mt-4 flex items-center gap-1.5 sm:max-w-md">
            {slides.map((s, i) => (
              <button
                key={s.eyebrow}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                aria-current={i === index}
                onClick={() => go(i)}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === index ? "2rem" : "0.5rem",
                  background:
                    i === index ? "#f59e0b" : "rgba(255,255,255,0.25)",
                  transitionDuration: "var(--transition-smooth)",
                }}
              />
            ))}
            <span className="ml-auto text-xs font-medium tabular-nums text-zinc-400">
              {index + 1} / {slides.length}
            </span>
          </div>

          {/* Primary and secondary actions */}
          <div className="mt-3.5 sm:mt-4 sm:max-w-md space-y-2">
            <button
              type="button"
              onClick={() => (last ? navigate('/auth/register') : go(index + 1))}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 px-5 py-3 sm:py-3.5 font-display text-sm sm:text-base font-bold text-black transition-all active:scale-[0.98] shadow-lg shadow-amber-500/25"
            >
              {last ? "Get Started" : "Continue"}
              <ArrowRight className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => navigate('/auth/login')}
              className="w-full rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 px-5 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold text-zinc-300 hover:text-white backdrop-blur-md transition-colors active:scale-[0.98]"
            >
              I already have an account
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
