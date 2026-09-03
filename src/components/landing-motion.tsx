'use client'

import { useEffect, useState } from 'react'

/**
 * Scroll-driven presentation for the landing page: elements marked
 * data-reveal enter when they scroll into view, the nav gains a shadow once
 * the page moves, and the nav link for the section on screen is marked
 * current. Everything degrades to static under prefers-reduced-motion.
 */
export function LandingMotion() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const targets = [...document.querySelectorAll<HTMLElement>('[data-reveal]')]
    if (reduced || typeof IntersectionObserver === 'undefined') {
      for (const target of targets) target.classList.add('is-in')
    }
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('is-in')
          reveal.unobserve(entry.target)
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    for (const target of targets) reveal.observe(target)

    const nav = document.querySelector('.lp-nav')
    const onScroll = () => nav?.classList.toggle('is-scrolled', window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    const links = [...document.querySelectorAll<HTMLAnchorElement>('.lp-nav nav a[href^="#"]')]
    const sections = links
      .map((link) => document.querySelector<HTMLElement>(link.getAttribute('href') ?? ''))
      .filter((section): section is HTMLElement => section !== null)
    const current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting)
        if (visible.length === 0) return
        const id = visible[0].target.id
        for (const link of links) {
          if (link.getAttribute('href') === `#${id}`) link.setAttribute('aria-current', 'true')
          else link.removeAttribute('aria-current')
        }
      },
      { rootMargin: '-40% 0px -50% 0px' },
    )
    for (const section of sections) current.observe(section)

    // The authority ladder lights one rung per beat as the beats scroll by.
    const ladder = document.querySelector<HTMLElement>('.lp-ladder')
    const beats = [...document.querySelectorAll<HTMLElement>('[data-beat]')]
    const steps = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !ladder) continue
          ladder.dataset.step = entry.target.getAttribute('data-beat') ?? '0'
          for (const beat of beats) beat.classList.toggle('is-current', beat === entry.target)
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    )
    for (const beat of beats) steps.observe(beat)
    if (reduced && ladder) ladder.dataset.step = String(beats.length)

    return () => {
      reveal.disconnect()
      current.disconnect()
      steps.disconnect()
      window.removeEventListener('scroll', onScroll)
    }
  }, [])
  return null
}

export function CopyPrompt({ prompt }: { prompt: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className={copied ? 'lp-copy is-copied' : 'lp-copy'}
      onClick={() => {
        void navigator.clipboard.writeText(prompt).then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1800)
        })
      }}
    >
      {copied ? 'Copied' : 'Copy prompt'}
    </button>
  )
}
