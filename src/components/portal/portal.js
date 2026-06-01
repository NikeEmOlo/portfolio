let portalOpen = false;
const portal = document.querySelector(".portal")

export function displayPortal(onHidden) {
    if (portalOpen) {
        portal.addEventListener('transitionend', onHidden, { once: true })
        portal.classList.remove("show")
    } else {
        portal.classList.add("show")
    }
    portalOpen = !portalOpen
}
