import Path from 'path';
import { fileURLToPath } from 'url';
import Server from '../../bin/nss.js';

// eslint-disable-next-line no-underscore-dangle
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line no-underscore-dangle
const __dirname = Path.dirname(__filename);

const WebsocketDemo = () => {
    // Determine where the directory for the website demo is.
    const websiteRoot = Path.normalize(Path.join(__dirname, '..', 'www-websockets'));

    // Minimal server configuration.
    const serverOptions = {
        dirListing: true,
        root: websiteRoot
    };

    // Get a new server instance.
    const server = new Server(serverOptions);

    // Start the server.
    server.start();

    // A bare minimum callback to handle changes.
    function callback(event, path, ext) {
        if (ext === 'css') {
            server.reloadAllStyles();
            return;
        }
        if (ext === 'js') {
            server.reloadAllPages();
            return;
        }
        if (event === 'change') {
            server.reloadSinglePage(path);
        }
    }

    // Build a bare minimum watcher options object.
    const watcherOptions = {
        events: {
            all: callback
        },
        ignoreInitial: true
    };

    /**
     * Watch everything in the www-socket directory for changes.
     *
     * NOTE: Watching for file changes is optional. If you build a local app or
     * a monitoring app that only needs NSS's websocket you can safely skip
     * setting up `watch`.
     */
    server.watch(websiteRoot, watcherOptions);

    // Keep a reply count so we can distinguish replies.
    const replyCount = {};

    // Build a simple websocket watcher (handler).
    function websocketHandler(message, pageId) {
        // Our demo only sends stings so ignore anything else.
        if (message.type === 'string') {
            // We record reply counts by page so make sure we have a record for this page.
            if (!replyCount[pageId]) { replyCount[pageId] = 0; }
            // Display the users message in the servers (NSS's) terminal.
            console.log(`[websocket:${pageId}] Message from frontend --> ${message.data}`);
            // To demonstrate we can reply send a message back after a delay.
            setTimeout(() => {
                replyCount[pageId] += 1;
                server.message(pageId, `Reply ${replyCount[pageId]} from backend to page with id: ${pageId}`);
            }, 2000);
        }
    }

    // Register our websocket handler to respond to only index pages.
    server.addWebsocketCallback('index.html', websocketHandler);

    // NOTE: We could add as many callbacks as we like for different pages or patterns.
};

export default WebsocketDemo;
