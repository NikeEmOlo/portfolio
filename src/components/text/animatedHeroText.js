import { gsap } from "gsap"
import { buildLetters, lettersIn, lettersOut, LINE_STAGGER, HOLD } from "./textAnimation.js"

function cycle(word, words, index, startDelay) {
    const letters = buildLetters(word, words[index])

    const timeline = gsap.timeline({
        delay: startDelay,
        onComplete: () => cycle(word, words, (index + 1) % words.length, 0),
    })

    lettersIn(timeline, letters)
    lettersOut(timeline, letters, `+=${HOLD}`)
}

document.addEventListener("astro:page-load", () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    document.querySelectorAll(".hero-line .word").forEach((word, lineIndex) => {
        const words = JSON.parse(word.dataset.words)
        cycle(word, words, 0, lineIndex * LINE_STAGGER)
    })
})
