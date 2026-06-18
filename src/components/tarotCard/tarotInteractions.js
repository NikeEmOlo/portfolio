import { navigate } from "astro:transitions/client";
import { gsap } from "gsap";

// Still consumed by TarotCardFront.astro (the dormant Overview panel).
export const tarotCardScale = 2;

let navigating = false;

// On click, a tarot card flips and scales up to fill the screen, then we navigate
// to its project page. The fullscreen surface is coloured to match the project
// hero, so the page swap underneath is hidden — the card appears to become the page.
function flipToPage(e) {
    const card = e.currentTarget;
    const id = card.dataset.id;
    if (!id || navigating) return;
    navigating = true;

    const cardEl = card.querySelector(".card-main");
    const rect = cardEl.getBoundingClientRect();

    // Build the flip overlay: a clone of the card (front) backed by a solid
    // destination-coloured surface (back). backface-visibility swaps them at 90°.
    const overlay = document.createElement("div");
    overlay.className = "flip-overlay";

    const scaler = document.createElement("div");
    scaler.className = "flip-scaler";

    const flipCard = document.createElement("div");
    flipCard.className = "flip-card";

    const front = cardEl.cloneNode(true);
    front.classList.add("flip-face", "flip-front");
    front.removeAttribute("aria-label");

    const back = document.createElement("div");
    back.className = "flip-face flip-back";

    flipCard.append(front, back);
    scaler.append(flipCard);
    overlay.append(scaler);
    document.body.append(overlay);

    // Hide the real card so it isn't doubled behind the clone.
    card.style.visibility = "hidden";

    gsap.set(scaler, {
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
    });

    const tl = gsap.timeline({ onComplete: () => navigate(`/${id}`) });
    // 1. Flip the card in place at its current size — the tarot face rotates away
    //    before the box ever grows, so the design never stretches.
    tl.to(flipCard, {
        rotationY: 180,
        duration: 0.5,
        ease: "power2.inOut",
    }, 0)
        // 2. Once it's almost flipped (showing the solid back), widen that surface
        //    to fill the screen — overlapping the tail so it reads as one swift move.
        .to(scaler, {
            top: 0,
            left: 0,
            width: window.innerWidth,
            height: window.innerHeight,
            duration: 0.55,
            ease: "power2.out",
        }, 0.38);
}

// Bind on every page load so cards stay clickable after a ClientRouter navigation
// back to the homepage (and reset the guard for the fresh visit).
document.addEventListener("astro:page-load", () => {
    const tarotList = document.querySelector(".cards-row");
    if (!tarotList) return;
    navigating = false;
    tarotList.querySelectorAll("li").forEach((card) => {
        card.addEventListener("click", flipToPage);
    });
});
