const intro = document.querySelector('#character-intro');
const idle = document.querySelector('#character-idle');
const wrapper = document.querySelector('.character-wrapper');

//-------------------------VIDEO---------------------------//
if (intro && idle && wrapper) {
    // Decode and hold idle's first frame so it's ready to show instantly.
    idle.play().then(() => idle.pause());

    let swapped = false;

    function doSwap() {
    if (swapped) return;
    swapped = true;
    idle.currentTime = 0;
    idle.play();
    // Fade idle in over ~3 frames so the browser composites smoothly.
    idle.style.transition = 'opacity 0.1s linear';
    idle.style.opacity = '1';
    }

    intro.addEventListener('ended', () => {
    intro.style.opacity = '0';
    }, { once: true });

    if (intro.requestVideoFrameCallback) {
    function onIntroFrame(now, metadata) {
        if (intro.duration && (intro.duration - metadata.mediaTime) <= 2 / 24) {
        doSwap();
        return;
        }
        intro.requestVideoFrameCallback(onIntroFrame);
    }
    intro.requestVideoFrameCallback(onIntroFrame);
    }

    intro.addEventListener('ended', doSwap, { once: true });
}

//------------------------ZOOM LOCK-----------------------------------//
if (matchMedia('(pointer: fine)').matches) {
    const baseRatio = window.devicePixelRatio;

    function counterZoom() {
    const scale = baseRatio / window.devicePixelRatio;
    wrapper.style.transform = `scale(${scale})`;
    }

    function watchZoom() {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', function handler() {
        mq.removeEventListener('change', handler);
        counterZoom();
        watchZoom();
    });
    }

    watchZoom();
}

