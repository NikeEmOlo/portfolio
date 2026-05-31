import { resetCards } from "./tarotCard/tarotInteractions.js"

//----------------------- DOM REFERENCES -----------------------//
const nav = document.querySelector('nav')
const navButtons = [...document.querySelectorAll('#project-list button')]
const allCards = [...document.querySelectorAll('.cards-row li[data-category]')]
const cardsRow = document.querySelector('.cards-row')
const hamburger = document.querySelector('.hamburger')
const navCloseBtn = document.querySelector('.close-btn')
const tabAnnouncement = document.getElementById('tab-announcement')

//----------------------- STATE -----------------------//
let isAnimating = false
let tarotOpen = false
export let currentCategory = null

//----------------------- CARD FILTER -----------------------//
export function applyFilter(category) {
    currentCategory = category
    const visibleCards = allCards.filter(c => c.dataset.category === category)
    allCards.forEach(c => c.classList.toggle('hidden', c.dataset.category !== category))
    cardsRow?.style.setProperty('--card-count', visibleCards.length)
    visibleCards.forEach((c, i) => c.style.setProperty('--index', i))
}

//----------------------- TAB SWITCHING -----------------------//
function animateTabSwitch(category) {
    const currentlyVisible = allCards.filter(c => !c.classList.contains('hidden'))
    const incomingCount = allCards.filter(c => c.dataset.category === category).length

    isAnimating = true
    navButtons.forEach(b => b.disabled = true)

    cardsRow.classList.add('is-animating')
    currentlyVisible.forEach(c => c.classList.add('at-center'))

    setTimeout(() => {
        applyFilter(category)
        allCards.forEach(c => {
            if (c.dataset.category !== category) c.classList.remove('at-center')
        })

        if (tabAnnouncement) {
            tabAnnouncement.textContent = ''
            requestAnimationFrame(() => {
                tabAnnouncement.textContent = `Showing ${incomingCount} ${category} project${incomingCount === 1 ? '' : 's'}`
            })
        }

        setTimeout(() => {
            cardsRow.classList.remove('is-animating')
            isAnimating = false
            navButtons.forEach(b => {
                b.disabled = b.getAttribute('aria-pressed') === 'true'
            })
        }, 1000)
    }, 1100)
}

navButtons.forEach(button => {
    button.addEventListener('click', () => {
        if (isAnimating) return
        navButtons.forEach(b => {
            const isActive = b === button
            b.setAttribute('aria-pressed', isActive ? 'true' : 'false')
            b.disabled = isActive
        })
        if (button.dataset.category) animateTabSwitch(button.dataset.category)
    })
})

// Initial filter — disable transitions so cards snap straight to fan positions on load
const firstCategoryButton = navButtons.find(b => b.dataset.category)
if (firstCategoryButton) {
    firstCategoryButton.setAttribute('aria-pressed', 'true')
    allCards.forEach(c => { c.style.transition = 'none' })
    applyFilter(firstCategoryButton.dataset.category)
    requestAnimationFrame(() => allCards.forEach(c => { c.style.transition = '' }))
}

//----------------------- HAMBURGER MENU -----------------------//
function closeMenu() {
    hamburger?.setAttribute('aria-expanded', 'false')
    hamburger?.setAttribute('aria-label', 'Open menu')
}

hamburger?.addEventListener('click', () => {
    const isExpanded = hamburger.getAttribute('aria-expanded') === 'true'
    hamburger.setAttribute('aria-expanded', String(!isExpanded))
    hamburger.setAttribute('aria-label', isExpanded ? 'Open menu' : 'Close menu')
})

navButtons.forEach(b => b.addEventListener('click', closeMenu))

document.addEventListener('click', e => {
    if (e.target instanceof Element && !e.target.closest('nav')) closeMenu()
})

//----------------------- NAV RESIZE -----------------------//
function updateNavMode() {
    if (!nav) return
    const wasMobile = nav.classList.contains('is-mobile')
    nav.classList.remove('is-mobile')
    nav.style.width = 'max-content'
    const naturalWidth = nav.offsetWidth
    nav.style.width = ''

    if (naturalWidth >= window.innerWidth) {
        nav.classList.add('is-mobile')
    } else if (wasMobile) {
        closeMenu()
    }
}

new ResizeObserver(updateNavMode).observe(document.documentElement)
updateNavMode()

//----------------------- TAROT CARD STATE -----------------------//
navCloseBtn?.addEventListener('click', resetCards)

export function updateNav() {
    tarotOpen = !tarotOpen
    nav.classList.toggle('tarot-close', tarotOpen)
}
