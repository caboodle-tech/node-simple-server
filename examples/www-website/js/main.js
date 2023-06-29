function loadFoxImage() {

    const container = document.getElementById('fox-container');
    if (!container) {
        console.log('DEMO: Could not locate the image container for the fox image.');
        return;
    }

    const details = document.getElementById('fox-details');
    if (!details) {
        console.log('DEMO: Could not locate the details container for the fox image.');
        return;
    }

    fetch('https://randomfox.ca/floof/')
        .then((response) => response.json())
        .then((json) => {
            container.style.background = 'transparent';
            container.innerHTML = `<img src="${json.image}">`;
            details.innerHTML = `Image Source: <a href="${json.link}" target="_blank">${json.link}</a>`;
            console.log('DEMO: Fox image successfully loaded.');
        })
        .catch((_) => {
            console.log('DEMO: There was an error trying to load the fox image.');
        });
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('DEMO: Loading a random image of a fox in 3 seconds...');
    setTimeout(() => {
        loadFoxImage();
    }, 3000);
});
