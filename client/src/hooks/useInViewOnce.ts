import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * True once the element has entered the viewport, and it never goes back —
 * an entrance plays once, not on every scroll past.
 *
 * Written for the About page's card entrance (2026-08-23), which animated
 * on MOUNT and was over before the below-the-fold cards were ever seen —
 * "it doesn't seem to work" was the animation firing into an empty
 * viewport.
 *
 * 🔴 FAILS OPEN. No IntersectionObserver (old browser, jsdom) → visible
 * immediately, so content never hides behind a trigger that cannot fire.
 * The caller applies the ANIMATION on visibility — never the content.
 */
export function useInViewOnce<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView) return
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      // Fire when the element is ~15% into the viewport, so the entrance
      // is actually seen rather than starting at the exact screen edge.
      { rootMargin: '0px 0px -15% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [inView])

  return [ref, inView]
}
