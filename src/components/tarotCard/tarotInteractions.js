import { gsap } from "gsap";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
gsap.registerPlugin(MotionPathPlugin);

const tarotList = document.querySelector(".cards-row")
const tarotCards = tarotList.querySelectorAll("li")


function tarotCardHandler(e) {
  const card = e.currentTarget;
  collapseCards(card);
  cardFlyIn(card)
}

function collapseCards(card) {
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
    const tl = gsap.timeline({ delay: .5, onStart: () => card.style.transition = 'none' });

    tl.set(card, { transformPerspective: 800, transformOrigin: "50% 30%" })
        .to(card, {
            rotationX: 20,
            duration: 0.5,
            ease: "power1.out"
        })
        .to(card, {
            scale: 3,
            duration: 2.0,
            ease: "sine.out"
        }, "-=0.2")
        .to(card, {
            rotationX: 0,
            duration: 1.2,
            ease: "elastic.out(1.5, 0.5)"
        }, ">");

    document.body.classList.add('darkened');
}






tarotCards.forEach((card) => {
  card.addEventListener("click", tarotCardHandler);
});
