import { gsap } from "gsap"

const STAGGER = 0.12
const LETTER_STAGGER = 0.04
const HOLD = 2.5

const HIDDEN = { width: 0, opacity: 0, filter: "blur(8px)" }

function buildLetters(container, word) {
    container.textContent = ""
    const fragment = document.createDocumentFragment()
    for (const char of word) {
        const letter = document.createElement("span")
        letter.className = "letter"
        letter.textContent = char
        fragment.appendChild(letter)
    }
    container.appendChild(fragment)
    return container.querySelectorAll(".letter")
}

function cycle(container, words, index, startDelay) {
    const letters = buildLetters(container, words[index])

    gsap.timeline({
        delay: startDelay,
        onComplete: () => cycle(container, words, (index + 1) % words.length, 0)
    })
        .from(letters, {
            ...HIDDEN,
            duration: 0.4,
            ease: "power2.out",
            stagger: LETTER_STAGGER
        })
        .to(letters, {
            ...HIDDEN,
            duration: 0.3,
            ease: "power2.in",
            stagger: { each: LETTER_STAGGER, from: "end" }
        }, `+=${HOLD}`)
}

document.addEventListener("astro:page-load", () => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (reducedMotion) return

    document.querySelectorAll(".hero-line .word").forEach((word, lineIndex) => {
        const words = JSON.parse(word.dataset.words)
        cycle(word, words, 0, lineIndex * STAGGER)
    })
})
