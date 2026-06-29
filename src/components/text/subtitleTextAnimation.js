import { gsap } from "gsap"
import { buildLetters, lettersIn, lettersOut, HOLD } from "./textAnimation.js"

function cycle(line, word, words, index) {
    const closeParen = line.querySelectorAll(".paren")[1]
    const letters = buildLetters(word, words[index], true)

    gsap.set(closeParen, { opacity: 0 })

    const timeline = gsap.timeline({
        onComplete: () => cycle(line, word, words, (index + 1) % words.length),
    })

    lettersIn(timeline, letters)
    timeline.to(closeParen, { opacity: 1, duration: 0.3 })               // appears once the text is in
    timeline.to(closeParen, { opacity: 0, duration: 0.3 }, `+=${HOLD}`)  // disappears before the text leaves
    lettersOut(timeline, letters, ">")
}

document.addEventListener("astro:page-load", () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return

    document.querySelectorAll(".subtitle-line").forEach((line) => {
        const word = line.querySelector(".word")
        const words = JSON.parse(word.dataset.words)
        cycle(line, word, words, 0)
    })
})
