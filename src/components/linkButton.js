import { navigate } from "astro:transitions/client";
import { gsap } from "gsap"
import { Flip } from "gsap/Flip"
gsap.registerPlugin(Flip)

function linkButtonHandler(e) {
    const button = e.currentTarget
    switch (button.dataset.variant) {
        case "overview":
            e.preventDefault()
            overviewToPageAnimation(button)
        break;
    }
}

function overviewToPageAnimation(button) {
    const overview = button.closest("[data-overview]")
    const cardFront = overview.querySelector(".tarot-front")
    const destination = button.getAttribute("href")

    const cardState = Flip.getState(cardFront, { props: "borderRadius" })
    cardFront.classList.add("diving")
    gsap.to(cardFront.children, { opacity: 0, duration: 0.1 })
    Flip.from(cardState, {
        duration: 0.8,
        ease: "power2.inOut",
        scale: true,
        props: "borderRadius",
        onComplete: () => navigate(destination)
    })
}
    

document.addEventListener("astro:page-load", () => {
    document.querySelectorAll(".link-button")
        .forEach(btn => btn.addEventListener("click", linkButtonHandler))
})