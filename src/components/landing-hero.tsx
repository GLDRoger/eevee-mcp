"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/**
 * Hero choreography. Words rise in one at a time, the product shot stands up
 * out of the hills in 3D and flattens as you scroll, the hills parallax at
 * three depths, and the pointer tilts the shot a few degrees. Under
 * prefers-reduced-motion nothing moves: the hero renders in its final state.
 */
export function HeroMotion() {
  useEffect(() => {
    const hero = document.querySelector<HTMLElement>(".lp-hero");
    if (!hero) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      hero.classList.add("is-static");
      return;
    }
    gsap.registerPlugin(ScrollTrigger);
    const context = gsap.context(() => {
      gsap.set(".lp-shot", {
        transformPerspective: 1600,
        rotateX: 16,
        transformOrigin: "50% 100%",
      });
      gsap.set(".lp-shot-stage", {
        transformPerspective: 1600,
        transformOrigin: "50% 100%",
      });
      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });
      intro
        .from(".lp-word", {
          yPercent: 120,
          rotateX: -50,
          opacity: 0,
          duration: 0.9,
          stagger: 0.055,
        })
        .from(".lp-hero-lede", { y: 24, opacity: 0, duration: 0.7 }, "-=0.45")
        .from(
          ".lp-hero-actions > *",
          { y: 18, opacity: 0, duration: 0.5, stagger: 0.1 },
          "-=0.45",
        )
        .from(
          ".lp-shot-stage",
          {
            y: 160,
            rotateX: 26,
            opacity: 0,
            duration: 1.3,
            ease: "power2.out",
          },
          "-=0.6",
        )
        .from(
          ".lp-float",
          { y: 36, opacity: 0, scale: 0.94, duration: 0.6, stagger: 0.16 },
          "-=0.7",
        );

      // Selectors inside gsap.context are scoped to `hero`, so the trigger must be the element itself.
      const scrub = (end = "bottom top") => ({
        trigger: hero,
        start: "top top",
        end,
        scrub: 0.6,
      });
      // Flat by the time the shot is centred on screen, not at the end of the hero.
      const shotWrap = hero.querySelector(".lp-shot-wrap");
      gsap.fromTo(
        ".lp-shot",
        { rotateX: 16, y: 0 },
        {
          rotateX: 0,
          y: -40,
          ease: "none",
          immediateRender: false,
          scrollTrigger: { trigger: shotWrap, start: "top 85%", end: "center 45%", scrub: 0.6 },
        },
      );
      gsap.to(".lp-hill.is-far", {
        yPercent: -18,
        ease: "none",
        scrollTrigger: scrub(),
      });
      gsap.to(".lp-hill.is-mid", {
        yPercent: -10,
        ease: "none",
        scrollTrigger: scrub(),
      });
      gsap.to(".lp-hill.is-near", {
        yPercent: 6,
        ease: "none",
        scrollTrigger: scrub(),
      });
      gsap.to(".lp-stars", {
        yPercent: -30,
        ease: "none",
        scrollTrigger: scrub(),
      });
      gsap.to(".lp-hero-copy", {
        y: -80,
        opacity: 0.2,
        ease: "none",
        scrollTrigger: scrub("60% top"),
      });

      const tilt = gsap.quickTo(".lp-shot", "rotateY", {
        duration: 0.8,
        ease: "power2.out",
      });
      const driftX = gsap.quickTo(".lp-hill.is-far", "x", {
        duration: 1.2,
        ease: "power2.out",
      });
      const onMove = (event: PointerEvent) => {
        const ratio = event.clientX / window.innerWidth - 0.5;
        tilt(ratio * 7);
        driftX(ratio * -24);
      };
      window.addEventListener("pointermove", onMove, { passive: true });
      return () => window.removeEventListener("pointermove", onMove);
    }, hero);
    return () => context.revert();
  }, []);
  return null;
}
