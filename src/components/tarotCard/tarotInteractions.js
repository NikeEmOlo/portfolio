import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { Flip } from "gsap/Flip";
import { updateNav, applyFilter, currentCategory } from "../navigation.js";
import { displayCardFront } from "./tarotCardFront.js";
gsap.registerPlugin(MotionPathPlugin, Flip);

const tarotList = document.querySelector(".cards-row")
const tarotCards = tarotList.querySelectorAll("li")
export const tarotCardScale = 2
let activeCard = null;


function tarotCardHandler(e) {
  const card = e.currentTarget;
  const id = card.dataset.overview;
  const overview = document.querySelector(`.overview[data-overview="${id}"]`)
  if (!overview) return; // card has no overview yet — do nothing

  collapseCards(card);
  cardFlyIn(card, overview); // overview is revealed when the fly-in finishes
  updateNav();
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

function cardFlyIn(card, overview) {
    const panel = overview.querySelector(".tarot-front");
    document.body.classList.add('fill-background');

    gsap.set(card, { transformPerspective: 800, transformOrigin: "50% 30%" });

    const tl = gsap.timeline({ delay: .5, onStart: () => { card.style.transition = 'none' } });

    // Quick 3D tilt flourish that ends with momentum, flowing straight into the swoop.
    tl.to(card, { rotationX: 20, duration: 0.35, ease: "power1.out" })
        .to(card, { rotationX: 0, duration: 0.35, ease: "power1.in" })
        .add(() => flyToPanel(card, panel, overview));
}

// Grow the card to panel size while gliding it across to the overview's panel slot —
// one continuous swoop (no pause at centre) — then reveal the overview and hand off.
function flyToPanel(card, panel, overview) {
    Flip.fit(card, panel, {
        duration: 1.0,
        ease: "power2.out",
        scale: true,
        onComplete: () => {
            overview.classList.add("show");
            gsap.to(card, { autoAlpha: 0, duration: 0.8 });
        },
    });
}

export function resetCards() {
    const overview = document.querySelector(".overview.show")
    overview?.classList.remove("show")       
    document.body.classList.remove("fill-background")

    gsap.to(activeCard, {                      
        x: 0,
        y: 0,
        scale: 1,
        rotationX: 0,
        autoAlpha: 1,
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
}


tarotCards.forEach((card) => {
  card.addEventListener("click", tarotCardHandler);
});
