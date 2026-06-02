import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { updateNav, applyFilter, currentCategory } from "../navigation.js";
import { displayCardFront } from "./tarotCardFront.js";
gsap.registerPlugin(MotionPathPlugin);

const tarotList = document.querySelector(".cards-row")
const tarotCards = tarotList.querySelectorAll("li")
export const tarotCardScale = 2
let activeCard = null;


function tarotCardHandler(e) {

  const card = e.currentTarget;
  collapseCards(card);
  cardFlyIn(card)
  updateNav()
}

function collapseCards(card) {
    activeCard = card; // remember which card was clicked
    tarotCards.forEach((c) => {
        c.classList.add("at-center")
    })

    setTimeout(() => {
        tarotCards.forEach((c) => {
            c !== card && c.classList.add("hidden")
        })
    }, 500)
}

function cardFlyIn(card) {
    const tl = gsap.timeline({ delay: .5, onStart: () => card.style.transition = 'none', onComplete: displayCardFront });

    tl.set(card, { transformPerspective: 800, transformOrigin: "50% 30%" })
        .to(card, {
            rotationX: 20,
            duration: 0.5,
            ease: "power1.out"
        })
        .to(card, {
            scale: tarotCardScale,
            duration: 1.0,
            ease: "sine.out"
        }, "-=0.2")
        .to(card, {
            rotationX: 0,
            duration: 1.2,
            ease: "elastic.out(1.5, 0.5)"
        }, ">");

    document.body.classList.add('darkened');
}

export function resetCards() {
    displayCardFront(() => {
        document.body.classList.remove("darkened")
        gsap.to(activeCard, {
            scale: 1,
            duration: 0.6,
            ease: "power2.in",
            onComplete: () => {
                gsap.set(activeCard, { clearProps: "all" })
                activeCard.style.transition = ''
                tarotCards.forEach(c => c.classList.remove('at-center'))
                applyFilter(currentCategory)
                activeCard = null;
                updateNav()
            }
        })
    })
}


tarotCards.forEach((card) => {
  card.addEventListener("click", tarotCardHandler);
});
