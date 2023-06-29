function setupChatApp() {
    // Make sure the basic elements are present on the page.
    const chatContainer = document.getElementById('chat');
    if (!chatContainer) { return; }

    const msgContainer = document.getElementById('messages');
    if (!msgContainer) { return; }

    const textarea = chatContainer.querySelector('textarea');
    if (!textarea) { return; }

    const button = chatContainer.querySelector('button');
    if (!button) { return; }

    // Allow submitting the message on enter key.
    textarea.addEventListener('keypress', (evt) => {
        if (evt.key === 'Enter' && !evt.shiftKey) {
            evt.preventDefault();
            chatContainer.querySelector('button').click();
        }
        textarea.style.height = '';
        textarea.style.height = `${textarea.scrollHeight}px`;
    });

    // Auto resize the textarea based on its input.
    textarea.addEventListener('input', () => {
        textarea.style.height = '';
        textarea.style.height = `${textarea.scrollHeight}px`;
    });

    // Handle websocket messages from the server.
    NSS_WS.registerCallback((msgObj) => {
        // NSS demos only use strings so check for that.
        if (msgObj.type === 'string') {
            // Add the servers response to the chat app.
            const msgDiv = document.createElement('div');
            msgDiv.classList.add('msg');
            msgDiv.classList.add('backend');
            msgDiv.innerHTML = msgObj.message;
            msgContainer.appendChild(msgDiv);
        }
    });

    // When the submit button (send icon) is pressed send a websocket message.
    button.addEventListener('click', () => {
        // Send the message.
        NSS_WS.send(textarea.value.replace(/\n/g, ' '));
        // Add the message to the chat app.
        const msgDiv = document.createElement('div');
        msgDiv.classList.add('msg');
        msgDiv.classList.add('frontend');
        msgDiv.innerHTML = textarea.value.replace(/\n/g, '<br>');
        msgContainer.appendChild(msgDiv);
        // Reset the chat message box.
        textarea.value = '';
        textarea.style.height = 'initial';
    });
}

// Wait until the page is ready and then setup the demo.
document.addEventListener('DOMContentLoaded', () => {
    setupChatApp();
});
