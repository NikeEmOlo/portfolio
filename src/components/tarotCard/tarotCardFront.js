let cardFrontOpen = false;
const cardFront = document.querySelector(".tarot-front")

export function displayCardFront(onHidden) {
    if (cardFrontOpen) {
        cardFront.addEventListener('transitionend', onHidden, { once: true })
        cardFront.classList.remove("show")
    } else {
        cardFront.classList.add("show")
    }
    cardFrontOpen = !cardFrontOpen
}
