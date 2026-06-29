import { gsap } from "gsap"

const OFFSET = 40
const STAGGER = 0.12
const HOLD = 2.5

const HIDDEN_LEFT = { x: -OFFSET, filter: "blur(8px)", opacity: 0 }
const HIDDEN_RIGHT = { x: OFFSET, filter: "blur(8px)", opacity: 0 }
const VISIBLE = { x: 0, filter: "blur(0px)", opacity: 1 }

function animateWord(word, lineIndex) {
    const words = JSON.parse(word.dataset.words)
    let index = 0

    gsap.set(word, HIDDEN_LEFT)

    gsap.timeline({ repeat: -1, delay: lineIndex * STAGGER })
        .to(word, { ...VISIBLE, duration: 0.5, ease: "power2.out" })
        .to(word, { ...HIDDEN_RIGHT, duration: 0.5, ease: "power2.in" }, `+=${HOLD}`)
        .call(() => {
            index = (index + 1) % words.length
            word.textContent = words[index]
            gsap.set(word, HIDDEN_LEFT)
        })
}

document.addEventListener("astro:page-load", () => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion) return

    document.querySelectorAll(".hero-line .word")
        .forEach((word, lineIndex) => animateWord(word, lineIndex))
})
