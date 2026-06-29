import { gsap } from "gsap"

export const LINE_STAGGER = 0.12
export const HOLD = 2.5

const LETTER_STAGGER = 0.04
const HIDDEN = { width: 0, opacity: 0, filter: "blur(8px)" }

// Replace a word container's text with one span per letter, returns the spans.
// With breakAfterComma, a line break is forced after each comma (the following space is dropped).
export function buildLetters(container, word, breakAfterComma = false) {
    container.textContent = ""
    const fragment = document.createDocumentFragment()
    const chars = [...word]

    for (let i = 0; i < chars.length; i++) {
        const letter = document.createElement("span")
        letter.className = "letter"
        letter.textContent = chars[i]
        fragment.appendChild(letter)

        if (breakAfterComma && chars[i] === ",") {
            fragment.appendChild(document.createElement("br"))
            if (chars[i + 1] === " ") i++
        }
    }

    container.appendChild(fragment)
    return container.querySelectorAll(".letter")
}

// Type the letters in, left to right.
export function lettersIn(timeline, letters, position) {
    timeline.from(letters, {
        ...HIDDEN,
        duration: 0.4,
        ease: "power2.out",
        stagger: LETTER_STAGGER,
    }, position)
}

// Wipe the letters out, right to left.
export function lettersOut(timeline, letters, position) {
    timeline.to(letters, {
        ...HIDDEN,
        duration: 0.3,
        ease: "power2.in",
        stagger: { each: LETTER_STAGGER, from: "end" },
    }, position)
}
