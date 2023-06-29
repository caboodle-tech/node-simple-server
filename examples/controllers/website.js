import Path from 'path';
import { fileURLToPath } from 'url';
import Server from '../../bin/nss.js';

// eslint-disable-next-line no-underscore-dangle
const __filename = fileURLToPath(import.meta.url);
// eslint-disable-next-line no-underscore-dangle
const __dirname = Path.dirname(__filename);

const WebsiteDemo = () => {
    // Determine where the directory for the website demo is.
    const websiteRoot = Path.normalize(Path.join(__dirname, '..', 'www-website'));

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
        console.log(event, path, ext);
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
     * Watch everything in the www-website directory for changes.
     *
     * NOTE: Watching for file changes is optional. If you build a local app or
     * a monitoring app that only needs NSS's websocket you can safely skip
     * setting up `watch`.
     */
    server.watch(websiteRoot, watcherOptions);
};

export default WebsiteDemo;
